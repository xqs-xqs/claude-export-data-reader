const { createHash } = require("node:crypto");
const { readFile, stat } = require("node:fs/promises");
const path = require("node:path");

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
  memoryFiles: 100_000,
  messages: 2_000_000,
  jsonDepth: 100,
  jsonNodes: 2_000_000,
  stringCharacters: 32 * MEBIBYTE
});

const SPLIT_EXPORT_CATEGORIES = new Set([
  "light_metadata",
  "projects",
  "memories",
  "conversations"
]);
const SPLIT_EXPORT_LIMITS = Object.freeze({
  files: 256,
  compressedBytes: 1024 * MEBIBYTE,
  entries: ARCHIVE_LIMITS.entries,
  jsonTotalBytes: ARCHIVE_LIMITS.jsonTotalBytes,
  jsonNodes: ARCHIVE_LIMITS.jsonNodes
});

let zipLibrary;

function getZipLibrary() {
  zipLibrary ||= require("jszip");
  return zipLibrary;
}

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

function assertJsonComplexity(value, label, sharedBudget) {
  const stack = [{ depth: 0, value }];
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (sharedBudget) {
      sharedBudget.used += 1;
      if (sharedBudget.used > sharedBudget.limit) {
        throw new Error(
          "The split export batch contains too many JSON values."
        );
      }
    }
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

async function readJsonText(
  entry,
  label,
  extractionBudget,
  totalLimit = ARCHIVE_LIMITS.jsonTotalBytes
) {
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
      if (extractionBudget.used > totalLimit) {
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
  const memoryFileSource =
    memory.memory_files === undefined || memory.memory_files === null
      ? []
      : requireArray(
          memory.memory_files,
          `${label}.memory_files`,
          ARCHIVE_LIMITS.memoryFiles
        );
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
    memory_files: memoryFileSource.map((value, index) => {
      const fileLabel = `${label}.memory_files[${index}]`;
      const file = requireRecord(value, fileLabel);
      return {
        path: requiredString(file.path, `${fileLabel}.path`, 65_536),
        content:
          optionalString(
            file.content,
            `${fileLabel}.content`,
            ARCHIVE_LIMITS.stringCharacters
          ) || "",
        updated_at: optionalString(
          file.updated_at,
          `${fileLabel}.updated_at`,
          256
        )
      };
    }),
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
  const zip = await getZipLibrary().loadAsync(buffer, { checkCRC32: false });
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
        memory_files: memory.memory_files,
        imported_from: path.basename(filePath),
        imported_at: importedAt,
        source_sha256: sha256
      };
    })
    .filter(
      (memory) =>
        memory.account_uuid &&
        (memory.conversations_memory !== undefined ||
          memory.memory_files.length > 0 ||
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

function looksLikeSplitRecord(value, category) {
  if (!isRecord(value)) return false;
  if (category === "conversations") {
    return typeof value.uuid === "string" && Array.isArray(value.chat_messages);
  }
  if (category === "projects") {
    return (
      typeof value.uuid === "string" &&
      ("name" in value ||
        "description" in value ||
        "docs" in value ||
        "creator" in value)
    );
  }
  if (category === "memories") {
    return (
      "account_uuid" in value ||
      "conversations_memory" in value ||
      "project_memories" in value ||
      "memory_files" in value
    );
  }
  const stableId = value.uuid ?? value.account_uuid ?? value.id;
  const displayName = value.full_name ?? value.name;
  const emailAddress = value.email_address ?? value.email;
  return (
    typeof stableId === "string" &&
    Boolean(stableId.trim()) &&
    ((typeof displayName === "string" && Boolean(displayName.trim())) ||
      (typeof emailAddress === "string" && Boolean(emailAddress.trim())))
  );
}

const SPLIT_RECORD_KEYS = Object.freeze({
  light_metadata: ["users", "user", "accounts", "account"],
  projects: ["projects", "project"],
  memories: ["memories", "memory"],
  conversations: ["conversations", "conversation"]
});

function isSplitUserFilename(value) {
  const filename = String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop();
  return /^(?:users?|accounts?|light[-_]metadata)(?:[-_]\d+)?\.(?:json|jsonl|ndjson)$/i.test(
    filename || ""
  );
}

function extractSplitRecords(
  value,
  category,
  label,
  depth = 0,
  sourceName = ""
) {
  if (depth > 3) return { recognized: false, records: [] };
  if (Array.isArray(value)) {
    if (
      category === "light_metadata" &&
      !isSplitUserFilename(sourceName)
    ) {
      return { recognized: false, records: [] };
    }
    if (
      value.length === 0 ||
      value.every((record) => looksLikeSplitRecord(record, category))
    ) {
      return { recognized: true, records: value };
    }
    return { recognized: false, records: [] };
  }
  if (!isRecord(value)) return { recognized: false, records: [] };

  for (const key of SPLIT_RECORD_KEYS[category]) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const nested = value[key];
    if (Array.isArray(nested)) {
      return { recognized: true, records: nested };
    }
    if (isRecord(nested)) {
      return { recognized: true, records: [nested] };
    }
    throw new TypeError(label + "." + key + " must contain records.");
  }

  for (const key of ["data", "items"]) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const nested = extractSplitRecords(
      value[key],
      category,
      label + "." + key,
      depth + 1,
      sourceName
    );
    if (nested.recognized) return nested;
  }

  if (
    category === "light_metadata" &&
    !isSplitUserFilename(sourceName)
  ) {
    return { recognized: false, records: [] };
  }
  return looksLikeSplitRecord(value, category)
    ? { recognized: true, records: [value] }
    : { recognized: false, records: [] };
}

function parseSplitJson(text, label, lineDelimited, complexityBudget) {
  if (!lineDelimited) {
    const value = JSON.parse(text);
    assertJsonComplexity(value, label, complexityBudget);
    return [value];
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const lineLabel = label + " line " + (index + 1);
      const value = JSON.parse(line);
      assertJsonComplexity(value, lineLabel, complexityBudget);
      return value;
    });
}

function isSplitDataEntry(category, entryName) {
  const normalized = String(entryName || "").replace(/\\/g, "/");
  if (category === "light_metadata") {
    return /^(?:users?|accounts?)(?:[-_]\d+)?\.(?:json|jsonl|ndjson)$/i.test(
      normalized
    );
  }
  if (category === "projects") {
    return /^(?:projects(?:[-_]\d+)?|projects\/[^/]+)\.(?:json|jsonl|ndjson)$/i.test(
      normalized
    );
  }
  if (category === "memories") {
    return /^(?:memories(?:[-_]\d+)?|memories\/[^/]+)\.(?:json|jsonl|ndjson)$/i.test(
      normalized
    );
  }
  return /^(?:conversations(?:[-_]\d+)?|conversations\/[^/]+)\.(?:json|jsonl|ndjson)$/i.test(
    normalized
  );
}

async function parseSplitArchivePart(
  descriptor,
  filePath,
  batchBudget
) {
  const archiveStat = await stat(filePath);
  if (!archiveStat.isFile()) {
    throw new TypeError(descriptor.filename + " is not a regular file.");
  }
  if (archiveStat.size > ARCHIVE_LIMITS.compressedBytes) {
    throw new Error(descriptor.filename + " is larger than 512 MiB.");
  }
  batchBudget.compressedBytes += archiveStat.size;
  if (batchBudget.compressedBytes > SPLIT_EXPORT_LIMITS.compressedBytes) {
    throw new Error("The split export batch is larger than the supported limit.");
  }

  const buffer = await readFile(filePath);
  if (buffer.length !== archiveStat.size) {
    throw new Error(descriptor.filename + " changed while it was being read.");
  }
  inspectCentralDirectory(buffer);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const zip = await getZipLibrary().loadAsync(buffer, { checkCRC32: false });
  const archiveEntries = Object.values(zip.files);
  batchBudget.entries += archiveEntries.length;
  if (batchBudget.entries > SPLIT_EXPORT_LIMITS.entries) {
    throw new Error("The split export batch contains too many entries.");
  }

  const jsonEntries = archiveEntries.filter(
    (entry) =>
      !entry.dir && isSplitDataEntry(descriptor.category, entry.name)
  );
  if (jsonEntries.length === 0) {
    throw new Error(
      descriptor.filename + " does not contain supported category data."
    );
  }

  for (const entry of jsonEntries) {
    const sizes = entrySizes(entry);
    if (sizes.uncompressedSize > ARCHIVE_LIMITS.jsonEntryBytes) {
      throw new Error(
        descriptor.filename + " contains a JSON entry larger than the limit."
      );
    }
    batchBudget.declaredJsonBytes += sizes.uncompressedSize;
    if (batchBudget.declaredJsonBytes > SPLIT_EXPORT_LIMITS.jsonTotalBytes) {
      throw new Error("The split export batch contains too much JSON data.");
    }
    if (
      sizes.uncompressedSize > MEBIBYTE &&
      (sizes.compressedSize === 0 ||
        sizes.uncompressedSize / sizes.compressedSize >
          ARCHIVE_LIMITS.compressionRatio)
    ) {
      throw new Error(
        descriptor.filename + " contains an unsafe compression ratio."
      );
    }
  }

  const records = [];
  let recognizedDocuments = 0;
  for (const entry of jsonEntries) {
    const label =
      descriptor.category + " archive " + descriptor.filename + ":" + entry.name;
    try {
      const text = await readJsonText(
        entry,
        label,
        batchBudget.extraction,
        SPLIT_EXPORT_LIMITS.jsonTotalBytes
      );
      const documents = parseSplitJson(
        text,
        label,
        /\.(?:jsonl|ndjson)$/i.test(entry.name),
        batchBudget.complexity
      );
      for (const document of documents) {
        const extracted = extractSplitRecords(
          document,
          descriptor.category,
          label,
          0,
          entry.name
        );
        if (!extracted.recognized) continue;
        recognizedDocuments += 1;
        for (const record of extracted.records) {
          records.push(record);
        }
      }
    } catch (error) {
      throw new Error("Unable to read local data from " + descriptor.filename + ".", {
        cause: error
      });
    }
  }
  if (recognizedDocuments === 0) {
    throw new Error(
      descriptor.filename + " uses an unsupported " + descriptor.category + " schema."
    );
  }
  return { sha256, records };
}

function normalizeSplitUser(value, label) {
  const user = requireRecord(value, label);
  const normalized = normalizeUser(
    {
      uuid: user.uuid ?? user.id ?? user.account_uuid,
      full_name: user.full_name ?? user.name,
      email_address: user.email_address ?? user.email
    },
    label
  );
  if (
    !normalized.uuid?.trim() ||
    (!normalized.full_name?.trim() && !normalized.email_address?.trim())
  ) {
    throw new TypeError(
      label + " must contain a stable account UUID and name or email."
    );
  }
  return normalized;
}

function mergeSplitMemories(memories) {
  const merged = new Map();
  for (const memory of memories) {
    if (!memory.account_uuid) continue;
    const current = merged.get(memory.account_uuid);
    if (!current) {
      merged.set(memory.account_uuid, memory);
      continue;
    }
    merged.set(memory.account_uuid, {
      ...current,
      conversations_memory:
        memory.conversations_memory ?? current.conversations_memory,
      project_memories: {
        ...current.project_memories,
        ...memory.project_memories
      },
      memory_files: mergeByKey(
        current.memory_files,
        memory.memory_files,
        (file) => file.path
      )
    });
  }
  return Array.from(merged.values());
}

function splitArchiveDescriptor(archivePath) {
  if (typeof archivePath !== "string") {
    throw new TypeError("Every split export ZIP path must be text.");
  }
  const filename = path.basename(archivePath);
  const match =
    /^(light_metadata|projects|memories|conversations)-(\d{3,})\.zip$/i.exec(
      filename
    );
  if (!match) {
    throw new Error(
      "新版 Claude 导出需要同时选择 light_metadata、projects、memories 和 conversations 分包。"
    );
  }
  const part = Number(match[2]);
  if (!Number.isSafeInteger(part)) {
    throw new Error("A split export ZIP has an invalid part number.");
  }
  return {
    category: match[1].toLocaleLowerCase("en-US"),
    part,
    filename
  };
}

async function parseSplitArchiveBatch(archivePaths) {
  if (!Array.isArray(archivePaths) || archivePaths.length === 0) {
    throw new TypeError("Select all Claude split export ZIPs together.");
  }
  if (archivePaths.length > SPLIT_EXPORT_LIMITS.files) {
    throw new Error("The split export batch contains too many ZIP files.");
  }

  const descriptors = archivePaths.map(splitArchiveDescriptor);
  const categoryParts = new Set();
  for (const descriptor of descriptors) {
    const key = descriptor.category + ":" + descriptor.part;
    if (categoryParts.has(key)) {
      throw new Error("The split export repeats a category part number.");
    }
    categoryParts.add(key);
  }
  for (const category of SPLIT_EXPORT_CATEGORIES) {
    const categoryFiles = descriptors
      .filter((descriptor) => descriptor.category === category)
      .sort((left, right) => left.part - right.part);
    if (categoryFiles.length === 0) {
      throw new Error("The split export is missing the " + category + " ZIP.");
    }
    categoryFiles.forEach((descriptor, index) => {
      if (descriptor.part !== index) {
        throw new Error(
          "The split export " + category +
            " parts must be continuous from 000."
        );
      }
    });
  }

  return parseSplitArchiveDescriptors(
    descriptors,
    archivePaths,
    "Claude split export (" + descriptors.length + " ZIPs)"
  );
}

async function parseSplitArchiveDescriptors(dataFiles, archivePaths, importedFrom) {
  if (!Array.isArray(archivePaths)) {
    throw new TypeError("Split export ZIP paths must be provided as an array.");
  }

  const declaredFiles = new Map(
    dataFiles.map((file) => [
      file.filename.toLocaleLowerCase("en-US"),
      file
    ])
  );
  const selectedFiles = new Map();
  for (const archivePath of archivePaths) {
    if (typeof archivePath !== "string") {
      throw new TypeError("Every split export ZIP path must be text.");
    }
    const basename = path.basename(archivePath);
    const key = basename.toLocaleLowerCase("en-US");
    if (!declaredFiles.has(key)) {
      throw new Error("A selected ZIP is not part of this split export batch.");
    }
    if (selectedFiles.has(key)) {
      throw new Error("A split export ZIP was selected more than once.");
    }
    selectedFiles.set(key, archivePath);
  }
  const missingFiles = dataFiles
    .filter(
      (file) =>
        !selectedFiles.has(file.filename.toLocaleLowerCase("en-US"))
    )
    .map((file) => file.filename);
  if (missingFiles.length > 0) {
    throw new Error("Missing split export ZIP files: " + missingFiles.join(", "));
  }

  const batchBudget = {
    compressedBytes: 0,
    entries: 0,
    declaredJsonBytes: 0,
    extraction: { used: 0 },
    complexity: { used: 0, limit: SPLIT_EXPORT_LIMITS.jsonNodes }
  };
  const raw = {
    light_metadata: [],
    projects: [],
    memories: [],
    conversations: []
  };
  const orderedDescriptors = [...dataFiles].sort(
    (left, right) =>
      left.category.localeCompare(right.category) ||
      left.part - right.part ||
      left.filename.localeCompare(right.filename)
  );
  const combinedHash = createHash("sha256");
  combinedHash.update("claude-export-split-v1\0");
  for (const descriptor of orderedDescriptors) {
    const key = descriptor.filename.toLocaleLowerCase("en-US");
    const parsedPart = await parseSplitArchivePart(
      descriptor,
      selectedFiles.get(key),
      batchBudget
    );
    for (const record of parsedPart.records) {
      raw[descriptor.category].push(record);
    }
    combinedHash.update(descriptor.category + "\0");
    combinedHash.update(String(descriptor.part) + "\0");
    combinedHash.update(descriptor.filename.toLocaleLowerCase("en-US") + "\0");
    combinedHash.update(parsedPart.sha256 + "\n");
  }

  if (raw.light_metadata.length > ARCHIVE_LIMITS.users) {
    throw new Error("The split export batch contains too many user records.");
  }
  if (raw.projects.length > ARCHIVE_LIMITS.projects) {
    throw new Error("The split export batch contains too many project records.");
  }
  if (raw.memories.length > ARCHIVE_LIMITS.memories) {
    throw new Error("The split export batch contains too many memory records.");
  }
  if (raw.conversations.length > ARCHIVE_LIMITS.conversations) {
    throw new Error("The split export batch contains too many conversations.");
  }

  const users = raw.light_metadata.map((user, index) =>
    normalizeSplitUser(user, "light_metadata[" + index + "]")
  );
  const conversations = raw.conversations.map((conversation, index) =>
    normalizeConversation(conversation, "conversations[" + index + "]")
  );
  const projects = raw.projects.map((project, index) =>
    normalizeProject(project, "projects[" + index + "]")
  );
  const rawMemories = raw.memories.map((memory, index) => {
    requireRecord(memory, "memories[" + index + "]");
    return normalizeMemoryRecord(memory, "memories[" + index + "]");
  });
  const messageCount = conversations.reduce(
    (count, conversation) => count + conversation.chat_messages.length,
    0
  );
  if (messageCount > ARCHIVE_LIMITS.messages) {
    throw new Error("The split export batch contains too many messages.");
  }

  const sha256 = combinedHash.digest("hex");
  const importedAt = new Date().toISOString();
  if (users.length === 0) {
    throw new Error("The light_metadata ZIP does not declare an account.");
  }
  const accountDetails = new Map();
  for (const user of users) {
    const current = accountDetails.get(user.uuid);
    accountDetails.set(user.uuid, {
      uuid: user.uuid,
      full_name: user.full_name || current?.full_name || "未命名账户",
      email_address: user.email_address || current?.email_address || "",
      imported_from: importedFrom
    });
  }

  function resolveDeclaredAccountUuid(primaryUuid, secondaryUuid, label) {
    const primary =
      typeof primaryUuid === "string" && primaryUuid.trim()
        ? primaryUuid
        : undefined;
    const secondary =
      typeof secondaryUuid === "string" && secondaryUuid.trim()
        ? secondaryUuid
        : undefined;
    if (primary && secondary && primary !== secondary) {
      throw new Error(label + " declares conflicting account UUIDs.");
    }
    const explicitUuid = primary || secondary;
    if (!explicitUuid) {
      throw new Error(label + " does not declare an account UUID.");
    }
    if (!accountDetails.has(explicitUuid)) {
      throw new Error(
        label + " belongs to an account not declared by light_metadata."
      );
    }
    return explicitUuid;
  }

  const accounts = Array.from(accountDetails.values());
  const normalizedConversations = mergeByKey(
    [],
    conversations.map(({ account, ...conversation }) => ({
      ...conversation,
      account_uuid: resolveDeclaredAccountUuid(
        account?.uuid,
        conversation.account_uuid,
        "Conversation " + conversation.uuid
      )
    })),
    (conversation) => conversation.account_uuid + ":" + conversation.uuid
  );
  const normalizedProjects = mergeByKey(
    [],
    projects.map(({ creator, ...project }) => ({
      ...project,
      account_uuid: resolveDeclaredAccountUuid(
        creator?.uuid,
        project.account_uuid,
        "Project " + project.uuid
      )
    })),
    (project) => project.account_uuid + ":" + project.uuid
  );
  const memories = mergeSplitMemories(
    rawMemories
      .map((memory) => ({
        account_uuid: resolveDeclaredAccountUuid(
          memory.account_uuid,
          undefined,
          "A memory record"
        ),
        conversations_memory: memory.conversations_memory,
        project_memories: memory.project_memories,
        memory_files: memory.memory_files,
        imported_from: importedFrom,
        imported_at: importedAt,
        source_sha256: sha256
      }))
      .filter(
        (memory) =>
          (memory.conversations_memory !== undefined ||
            memory.memory_files.length > 0 ||
            Object.keys(memory.project_memories).length > 0)
      )
  );

  return {
    sha256,
    filename: importedFrom,
    importedAt,
    accounts,
    conversations: normalizedConversations,
    projects: normalizedProjects,
    memories
  };
}

module.exports = {
  mergeByKey,
  normalizeStoredLibrary,
  parseArchive,
  parseSplitArchiveBatch
};
