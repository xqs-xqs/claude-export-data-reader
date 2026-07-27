const { createHash } = require("node:crypto");
const { readFile, stat } = require("node:fs/promises");
const path = require("node:path");
const JSZip = require("jszip");

const MEBIBYTE = 1024 * 1024;
const ARCHIVE_LIMITS = Object.freeze({
  compressedBytes: 512 * MEBIBYTE,
  entries: 20_000,
  jsonEntryBytes: 128 * MEBIBYTE,
  jsonTotalBytes: 256 * MEBIBYTE,
  compressionRatio: 250,
  projects: 5_000,
  users: 1_000,
  conversations: 100_000,
  memories: 1_000,
  messages: 2_000_000,
  jsonDepth: 100,
  jsonNodes: 2_000_000,
  stringCharacters: 32 * MEBIBYTE
});

function inspectCentralDirectory(buffer) {
  const minimumEocdBytes = 22;
  const maximumCommentBytes = 0xffff;
  const searchStart = Math.max(
    0,
    buffer.length - minimumEocdBytes - maximumCommentBytes
  );
  let eocdOffset = -1;

  for (
    let offset = buffer.length - minimumEocdBytes;
    offset >= searchStart;
    offset -= 1
  ) {
    if (buffer.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentBytes = buffer.readUInt16LE(offset + 20);
    if (offset + minimumEocdBytes + commentBytes === buffer.length) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("The selected file does not contain a valid ZIP directory.");
  }

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const directoryDisk = buffer.readUInt16LE(eocdOffset + 6);
  const diskEntries = buffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const directoryBytes = buffer.readUInt32LE(eocdOffset + 12);
  const directoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (
    diskNumber !== 0 ||
    directoryDisk !== 0 ||
    diskEntries !== totalEntries
  ) {
    throw new Error("Multi-disk ZIP archives are not supported.");
  }
  if (
    totalEntries === 0xffff ||
    directoryBytes === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    throw new Error("ZIP64 archives are not supported.");
  }
  if (totalEntries > ARCHIVE_LIMITS.entries) {
    throw new Error("The selected ZIP contains too many entries.");
  }

  const directoryEnd = directoryOffset + directoryBytes;
  if (
    !Number.isSafeInteger(directoryEnd) ||
    directoryEnd > eocdOffset ||
    directoryOffset < 0
  ) {
    throw new Error("The selected ZIP has an invalid central directory.");
  }

  let cursor = directoryOffset;
  let countedEntries = 0;
  while (cursor < directoryEnd) {
    if (
      cursor + 46 > directoryEnd ||
      buffer.readUInt32LE(cursor) !== 0x02014b50
    ) {
      throw new Error("The selected ZIP has a malformed central directory.");
    }
    const fileNameBytes = buffer.readUInt16LE(cursor + 28);
    const extraBytes = buffer.readUInt16LE(cursor + 30);
    const commentBytes = buffer.readUInt16LE(cursor + 32);
    cursor += 46 + fileNameBytes + extraBytes + commentBytes;
    countedEntries += 1;
    if (countedEntries > ARCHIVE_LIMITS.entries) {
      throw new Error("The selected ZIP contains too many entries.");
    }
  }
  if (cursor !== directoryEnd || countedEntries !== totalEntries) {
    throw new Error("The selected ZIP directory entry count is inconsistent.");
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function entrySizes(entry) {
  const compressedSize = entry?._data?.compressedSize;
  const uncompressedSize = entry?._data?.uncompressedSize;
  if (
    !Number.isSafeInteger(compressedSize) ||
    compressedSize < 0 ||
    !Number.isSafeInteger(uncompressedSize) ||
    uncompressedSize < 0
  ) {
    throw new Error(`Cannot verify the size of ZIP entry "${entry?.name}".`);
  }
  return { compressedSize, uncompressedSize };
}

function assertJsonComplexity(value, label) {
  const stack = [{ depth: 0, value }];
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > ARCHIVE_LIMITS.jsonNodes) {
      throw new Error(`${label} contains too many JSON values.`);
    }
    if (current.depth > ARCHIVE_LIMITS.jsonDepth) {
      throw new Error(`${label} is nested too deeply.`);
    }
    if (
      typeof current.value === "string" &&
      current.value.length > ARCHIVE_LIMITS.stringCharacters
    ) {
      throw new Error(`${label} contains an unexpectedly large text value.`);
    }
    if (!current.value || typeof current.value !== "object") continue;

    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value);
    for (const child of children) {
      stack.push({ depth: current.depth + 1, value: child });
    }
  }
}

function requireArray(value, label, maximumLength) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must contain a JSON array.`);
  }
  if (value.length > maximumLength) {
    throw new Error(`${label} contains too many records.`);
  }
  return value;
}

function requireRecord(value, label) {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must contain a JSON object.`);
  }
  return value;
}

function optionalString(value, label, maximumCharacters = 32 * MEBIBYTE) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be text.`);
  }
  if (value.length > maximumCharacters) {
    throw new Error(`${label} is longer than the supported limit.`);
  }
  return value;
}

function requiredString(value, label, maximumCharacters = 4096) {
  const text = optionalString(value, label, maximumCharacters);
  if (!text?.trim()) {
    throw new TypeError(`${label} must be non-empty text.`);
  }
  return text;
}

function optionalBoolean(value, label) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }
  return value;
}

function optionalNumber(value, label) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

async function readJsonText(entry, label, extractionBudget) {
  const chunks = [];
  let entryBytes = 0;
  const stream = entry.internalStream("uint8array");

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      stream.pause();
      reject(error);
    };

    stream.on("data", (chunk) => {
      if (settled) return;
      entryBytes += chunk.byteLength;
      extractionBudget.used += chunk.byteLength;
      if (entryBytes > ARCHIVE_LIMITS.jsonEntryBytes) {
        fail(new Error(`${label} exceeds the actual extraction limit.`));
        return;
      }
      if (extractionBudget.used > ARCHIVE_LIMITS.jsonTotalBytes) {
        fail(new Error("The archive exceeds the total JSON extraction limit."));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    stream.on("error", fail);
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, entryBytes).toString("utf8"));
    });
    stream.resume();
  });
}

function normalizeCitation(value, label) {
  const citation = requireRecord(value, label);
  const details =
    citation.details === undefined || citation.details === null
      ? undefined
      : requireRecord(citation.details, `${label}.details`);
  return {
    uuid: optionalString(citation.uuid, `${label}.uuid`, 4096),
    start_index: optionalNumber(
      citation.start_index,
      `${label}.start_index`
    ),
    end_index: optionalNumber(citation.end_index, `${label}.end_index`),
    details: details
      ? {
          type: optionalString(details.type, `${label}.details.type`, 256),
          url: optionalString(details.url, `${label}.details.url`, 65_536)
        }
      : undefined
  };
}

function normalizeContentBlock(value, label) {
  const block = requireRecord(value, label);
  const citations =
    block.citations === undefined || block.citations === null
      ? undefined
      : requireArray(block.citations, `${label}.citations`, 100_000).map(
          (citation, index) =>
            normalizeCitation(citation, `${label}.citations[${index}]`)
        );
  return {
    type: requiredString(block.type, `${label}.type`, 256),
    text: optionalString(block.text, `${label}.text`),
    thinking: optionalString(block.thinking, `${label}.thinking`),
    thinking_hidden: optionalBoolean(
      block.thinking_hidden,
      `${label}.thinking_hidden`
    ),
    hidden: optionalBoolean(block.hidden, `${label}.hidden`),
    hidden_in_chat: optionalBoolean(
      block.hidden_in_chat,
      `${label}.hidden_in_chat`
    ),
    truncated: optionalBoolean(block.truncated, `${label}.truncated`),
    cut_off: optionalBoolean(block.cut_off, `${label}.cut_off`),
    id: optionalString(block.id, `${label}.id`, 4096),
    tool_use_id: optionalString(
      block.tool_use_id,
      `${label}.tool_use_id`,
      4096
    ),
    name: optionalString(block.name, `${label}.name`, 4096),
    input: block.input,
    content: block.content,
    display_content: block.display_content,
    structured_content: block.structured_content,
    integration_name: optionalString(
      block.integration_name,
      `${label}.integration_name`,
      4096
    ),
    is_error: optionalBoolean(block.is_error, `${label}.is_error`),
    citations
  };
}

function normalizeAttachment(value, label) {
  const attachment = requireRecord(value, label);
  return {
    file_name: optionalString(
      attachment.file_name,
      `${label}.file_name`,
      65_536
    ),
    file_size: optionalNumber(attachment.file_size, `${label}.file_size`),
    file_type: optionalString(
      attachment.file_type,
      `${label}.file_type`,
      4096
    ),
    extracted_content: optionalString(
      attachment.extracted_content,
      `${label}.extracted_content`
    )
  };
}

function normalizeFileReference(value, label) {
  const file = requireRecord(value, label);
  return {
    file_name: optionalString(file.file_name, `${label}.file_name`, 65_536),
    file_uuid: optionalString(file.file_uuid, `${label}.file_uuid`, 4096)
  };
}

function normalizeMessage(value, label) {
  const message = requireRecord(value, label);
  if (message.sender !== "human" && message.sender !== "assistant") {
    throw new TypeError(`${label}.sender must be "human" or "assistant".`);
  }
  const content =
    message.content === undefined || message.content === null
      ? undefined
      : requireArray(message.content, `${label}.content`, 100_000).map(
          (block, index) =>
            normalizeContentBlock(block, `${label}.content[${index}]`)
        );
  const attachments =
    message.attachments === undefined || message.attachments === null
      ? undefined
      : requireArray(
          message.attachments,
          `${label}.attachments`,
          100_000
        ).map((attachment, index) =>
          normalizeAttachment(attachment, `${label}.attachments[${index}]`)
        );
  const files =
    message.files === undefined || message.files === null
      ? undefined
      : requireArray(message.files, `${label}.files`, 100_000).map(
          (file, index) =>
            normalizeFileReference(file, `${label}.files[${index}]`)
        );
  return {
    uuid: requiredString(message.uuid, `${label}.uuid`, 4096),
    text: optionalString(message.text, `${label}.text`),
    content,
    sender: message.sender,
    created_at: optionalString(
      message.created_at,
      `${label}.created_at`,
      256
    ),
    updated_at: optionalString(
      message.updated_at,
      `${label}.updated_at`,
      256
    ),
    attachments,
    files,
    parent_message_uuid: optionalString(
      message.parent_message_uuid,
      `${label}.parent_message_uuid`,
      4096
    )
  };
}

function normalizeConversation(value, label) {
  const conversation = requireRecord(value, label);
  const messages = requireArray(
    conversation.chat_messages,
    `${label}.chat_messages`,
    ARCHIVE_LIMITS.messages
  ).map((message, index) =>
    normalizeMessage(message, `${label}.chat_messages[${index}]`)
  );
  const account =
    conversation.account === undefined || conversation.account === null
      ? undefined
      : requireRecord(conversation.account, `${label}.account`);
  return {
    uuid: requiredString(conversation.uuid, `${label}.uuid`, 4096),
    account_uuid: optionalString(
      conversation.account_uuid,
      `${label}.account_uuid`,
      4096
    ),
    account: account
      ? {
          uuid: optionalString(account.uuid, `${label}.account.uuid`, 4096)
        }
      : undefined,
    name: optionalString(conversation.name, `${label}.name`, 65_536),
    summary: optionalString(conversation.summary, `${label}.summary`),
    created_at: optionalString(
      conversation.created_at,
      `${label}.created_at`,
      256
    ),
    updated_at: optionalString(
      conversation.updated_at,
      `${label}.updated_at`,
      256
    ),
    chat_messages: messages
  };
}

function normalizeUser(value, label) {
  const user = requireRecord(value, label);
  return {
    uuid: optionalString(user.uuid, `${label}.uuid`, 4096),
    full_name: optionalString(user.full_name, `${label}.full_name`, 65_536),
    email_address: optionalString(
      user.email_address,
      `${label}.email_address`,
      65_536
    )
  };
}

function normalizeProject(value, label) {
  const project = requireRecord(value, label);
  const creator =
    project.creator === undefined || project.creator === null
      ? undefined
      : requireRecord(project.creator, `${label}.creator`);
  const docs =
    project.docs === undefined || project.docs === null
      ? undefined
      : requireArray(project.docs, `${label}.docs`, 100_000).map(
          (value, index) => {
            const doc = requireRecord(value, `${label}.docs[${index}]`);
            return {
              uuid: optionalString(
                doc.uuid,
                `${label}.docs[${index}].uuid`,
                4096
              ),
              filename: optionalString(
                doc.filename,
                `${label}.docs[${index}].filename`,
                65_536
              ),
              content: optionalString(
                doc.content,
                `${label}.docs[${index}].content`
              ),
              created_at: optionalString(
                doc.created_at,
                `${label}.docs[${index}].created_at`,
                256
              )
            };
          }
        );
  return {
    uuid: requiredString(project.uuid, `${label}.uuid`, 4096),
    account_uuid: optionalString(
      project.account_uuid,
      `${label}.account_uuid`,
      4096
    ),
    creator: creator
      ? {
          uuid: optionalString(creator.uuid, `${label}.creator.uuid`, 4096)
        }
      : undefined,
    name: optionalString(project.name, `${label}.name`, 65_536),
    description: optionalString(
      project.description,
      `${label}.description`
    ),
    docs
  };
}

function normalizeMemoryRecord(value, label) {
  const memory = requireRecord(value, label);
  const projectMemorySource =
    memory.project_memories === undefined ||
    memory.project_memories === null
      ? {}
      : requireRecord(memory.project_memories, `${label}.project_memories`);
  return {
    account_uuid: optionalString(
      memory.account_uuid,
      `${label}.account_uuid`,
      4096
    ),
    conversations_memory: optionalString(
      memory.conversations_memory,
      `${label}.conversations_memory`
    ),
    project_memories: Object.fromEntries(
      Object.entries(projectMemorySource).map(([projectUuid, text]) => [
        requiredString(projectUuid, `${label}.project_memories key`, 4096),
        requiredString(
          text,
          `${label}.project_memories.${projectUuid}`,
          ARCHIVE_LIMITS.stringCharacters
        )
      ])
    ),
    imported_from: optionalString(
      memory.imported_from,
      `${label}.imported_from`,
      65_536
    ),
    imported_at: optionalString(
      memory.imported_at,
      `${label}.imported_at`,
      256
    ),
    source_sha256: optionalString(
      memory.source_sha256,
      `${label}.source_sha256`,
      256
    )
  };
}

function normalizeStoredLibrary(value) {
  const library = requireRecord(value, "reader-data.json");
  const imports = requireArray(
    library.imports ?? [],
    "reader-data.json.imports",
    100_000
  ).map((value, index) => {
    const label = `reader-data.json.imports[${index}]`;
    const record = requireRecord(value, label);
    return {
      sha256: requiredString(record.sha256, `${label}.sha256`, 256),
      filename: requiredString(record.filename, `${label}.filename`, 65_536),
      imported_at: requiredString(
        record.imported_at,
        `${label}.imported_at`,
        256
      ),
      conversation_count:
        optionalNumber(
          record.conversation_count,
          `${label}.conversation_count`
        ) || 0
    };
  });
  const accounts = requireArray(
    library.accounts ?? [],
    "reader-data.json.accounts",
    ARCHIVE_LIMITS.users
  ).map((value, index) => {
    const label = `reader-data.json.accounts[${index}]`;
    const account = requireRecord(value, label);
    return {
      uuid: requiredString(account.uuid, `${label}.uuid`, 4096),
      full_name: optionalString(
        account.full_name,
        `${label}.full_name`,
        65_536
      ),
      email_address: optionalString(
        account.email_address,
        `${label}.email_address`,
        65_536
      ),
      imported_from: optionalString(
        account.imported_from,
        `${label}.imported_from`,
        65_536
      )
    };
  });
  const conversations = requireArray(
    library.conversations ?? [],
    "reader-data.json.conversations",
    ARCHIVE_LIMITS.conversations
  ).map((value, index) => {
    const label = `reader-data.json.conversations[${index}]`;
    const { account: _account, ...conversation } = normalizeConversation(
      value,
      label
    );
    return {
      ...conversation,
      account_uuid: requiredString(
        conversation.account_uuid,
        `${label}.account_uuid`,
        4096
      )
    };
  });
  const projects = requireArray(
    library.projects ?? [],
    "reader-data.json.projects",
    ARCHIVE_LIMITS.projects
  ).map((value, index) => {
    const label = `reader-data.json.projects[${index}]`;
    const { creator: _creator, ...project } = normalizeProject(value, label);
    return {
      ...project,
      account_uuid: requiredString(
        project.account_uuid,
        `${label}.account_uuid`,
        4096
      )
    };
  });
  const memories = requireArray(
    library.memories ?? [],
    "reader-data.json.memories",
    ARCHIVE_LIMITS.memories
  ).map((value, index) => {
    const label = `reader-data.json.memories[${index}]`;
    const memory = normalizeMemoryRecord(value, label);
    return {
      ...memory,
      account_uuid: requiredString(
        memory.account_uuid,
        `${label}.account_uuid`,
        4096
      )
    };
  });
  const pinnedConversations = requireArray(
    library.pinned_conversations ?? [],
    "reader-data.json.pinned_conversations",
    ARCHIVE_LIMITS.conversations
  ).map((value, index) => {
    const label = `reader-data.json.pinned_conversations[${index}]`;
    const pinned = requireRecord(value, label);
    return {
      conversation_key: requiredString(
        pinned.conversation_key,
        `${label}.conversation_key`,
        8192
      ),
      pinned_at: requiredString(
        pinned.pinned_at,
        `${label}.pinned_at`,
        256
      )
    };
  });

  return {
    version: 1,
    imports,
    accounts,
    conversations,
    projects,
    memories,
    pinned_conversations: pinnedConversations
  };
}

function mergeByKey(existing, incoming, keyFor) {
  const output = [...existing];
  const positions = new Map(output.map((item, index) => [keyFor(item), index]));
  for (const item of incoming) {
    const key = keyFor(item);
    if (positions.has(key)) {
      output[positions.get(key)] = item;
    } else {
      positions.set(key, output.length);
      output.push(item);
    }
  }
  return output;
}

async function parseArchive(filePath) {
  const archiveStat = await stat(filePath);
  if (!archiveStat.isFile()) {
    throw new TypeError("The selected archive is not a regular file.");
  }
  if (archiveStat.size > ARCHIVE_LIMITS.compressedBytes) {
    throw new Error("The selected ZIP is larger than the supported 512 MiB limit.");
  }

  const buffer = await readFile(filePath);
  if (buffer.length > ARCHIVE_LIMITS.compressedBytes) {
    throw new Error("The selected ZIP grew beyond the supported 512 MiB limit.");
  }
  inspectCentralDirectory(buffer);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const importedAt = new Date().toISOString();
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: false });
  const archiveEntries = Object.values(zip.files);
  if (archiveEntries.length > ARCHIVE_LIMITS.entries) {
    throw new Error("The selected ZIP contains too many entries.");
  }

  const projectEntries = archiveEntries.filter(
    (entry) => !entry.dir && /^projects\/[^/]+\.json$/i.test(entry.name)
  );
  if (projectEntries.length > ARCHIVE_LIMITS.projects) {
    throw new Error("The selected ZIP contains too many project records.");
  }

  const targetEntries = [
    zip.file("users.json"),
    zip.file("conversations.json"),
    zip.file("memories.json"),
    ...projectEntries
  ].filter(Boolean);
  let totalUncompressedBytes = 0;
  for (const entry of targetEntries) {
    const { compressedSize, uncompressedSize } = entrySizes(entry);
    if (uncompressedSize > ARCHIVE_LIMITS.jsonEntryBytes) {
      throw new Error(`ZIP entry "${entry.name}" is larger than the supported limit.`);
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > ARCHIVE_LIMITS.jsonTotalBytes) {
      throw new Error("The selected ZIP contains too much uncompressed JSON data.");
    }
    if (
      uncompressedSize > MEBIBYTE &&
      (compressedSize === 0 ||
        uncompressedSize / compressedSize > ARCHIVE_LIMITS.compressionRatio)
    ) {
      throw new Error(`ZIP entry "${entry.name}" has an unsafe compression ratio.`);
    }
  }

  const extractionBudget = { used: 0 };
  async function jsonEntry(name, fallback) {
    const entry = zip.file(name);
    if (!entry) return fallback;
    try {
      const value = JSON.parse(
        await readJsonText(entry, name, extractionBudget)
      );
      assertJsonComplexity(value, name);
      return value;
    } catch (error) {
      throw new Error(`Unable to read ${name}: ${error.message}`, {
        cause: error
      });
    }
  }

  const users = requireArray(
    await jsonEntry("users.json", []),
    "users.json",
    ARCHIVE_LIMITS.users
  ).map((user, index) => normalizeUser(user, `users.json[${index}]`));
  const conversations = requireArray(
    await jsonEntry("conversations.json", []),
    "conversations.json",
    ARCHIVE_LIMITS.conversations
  ).map((conversation, index) =>
    normalizeConversation(conversation, `conversations.json[${index}]`)
  );
  const rawMemories = requireArray(
    await jsonEntry("memories.json", []),
    "memories.json",
    ARCHIVE_LIMITS.memories
  );
  const messageCount = conversations.reduce(
    (count, conversation) => count + conversation.chat_messages.length,
    0
  );
  if (messageCount > ARCHIVE_LIMITS.messages) {
    throw new Error("conversations.json contains too many messages.");
  }
  rawMemories.forEach((memory, index) =>
    requireRecord(memory, `memories.json[${index}]`)
  );

  const projects = [];
  for (const entry of projectEntries) {
    const project = await jsonEntry(entry.name, undefined);
    projects.push(normalizeProject(project, entry.name));
  }

  const primaryUser = users[0] || {};
  const fallbackAccountUuid =
    conversations.find(
      (conversation) =>
        conversation.account?.uuid || conversation.account_uuid
    )?.account?.uuid ||
    conversations.find((conversation) => conversation.account_uuid)
      ?.account_uuid ||
    rawMemories
      .map((memory, index) => {
        const record = requireRecord(memory, `memories.json[${index}]`);
        return optionalString(
          record.account_uuid,
          `memories.json[${index}].account_uuid`,
          4096
        );
      })
      .find(Boolean) ||
    `unknown-${sha256.slice(0, 12)}`;

  const accounts = users.length
    ? users.map((user) => ({
        uuid: user.uuid || fallbackAccountUuid,
        full_name: user.full_name || "未命名账户",
        email_address: user.email_address || "",
        imported_from: path.basename(filePath)
      }))
    : [
        {
          uuid: fallbackAccountUuid,
          full_name: "未命名账户",
          email_address: "",
          imported_from: path.basename(filePath)
        }
      ];

  const memories = rawMemories
    .map((value, index) => {
      const label = `memories.json[${index}]`;
      const memory = normalizeMemoryRecord(value, label);
      return {
        account_uuid:
          memory.account_uuid ||
          (accounts.length === 1 ? accounts[0].uuid : undefined),
        conversations_memory: memory.conversations_memory,
        project_memories: memory.project_memories,
        imported_from: path.basename(filePath),
        imported_at: importedAt,
        source_sha256: sha256
      };
    })
    .filter(
      (memory) =>
        memory.account_uuid &&
        (memory.conversations_memory !== undefined ||
          Object.keys(memory.project_memories).length > 0)
    );

  return {
    sha256,
    filename: path.basename(filePath),
    importedAt,
    accounts,
    conversations: conversations.map(({ account, ...conversation }) => ({
      ...conversation,
      account_uuid:
        account?.uuid ||
        conversation.account_uuid ||
        primaryUser.uuid ||
        fallbackAccountUuid
    })),
    projects: projects.map(({ creator, ...project }) => ({
      ...project,
      account_uuid:
        creator?.uuid ||
        project.account_uuid ||
        primaryUser.uuid ||
        fallbackAccountUuid
    })),
    memories
  };
}

module.exports = {
  mergeByKey,
  normalizeStoredLibrary,
  parseArchive
};
