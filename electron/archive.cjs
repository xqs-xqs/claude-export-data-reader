const { createHash } = require("node:crypto");
const { readFile, stat } = require("node:fs/promises");
const path = require("node:path");
const JSZip = require("jszip");

const MEBIBYTE = 1024 * 1024;
const ARCHIVE_LIMITS = Object.freeze({
  compressedBytes: 512 * MEBIBYTE,
  entries: 20_000,
  jsonEntryBytes: 256 * MEBIBYTE,
  jsonTotalBytes: 512 * MEBIBYTE,
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

  async function jsonEntry(name, fallback) {
    const entry = zip.file(name);
    if (!entry) return fallback;
    try {
      const value = JSON.parse(await entry.async("string"));
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
  );
  const conversations = requireArray(
    await jsonEntry("conversations.json", []),
    "conversations.json",
    ARCHIVE_LIMITS.conversations
  );
  const rawMemories = requireArray(
    await jsonEntry("memories.json", []),
    "memories.json",
    ARCHIVE_LIMITS.memories
  );
  users.forEach((user, index) =>
    requireRecord(user, `users.json[${index}]`)
  );
  let messageCount = 0;
  conversations.forEach((conversation, index) => {
    requireRecord(conversation, `conversations.json[${index}]`);
    if (
      conversation.chat_messages !== undefined &&
      !Array.isArray(conversation.chat_messages)
    ) {
      throw new TypeError(
        `conversations.json[${index}].chat_messages must be an array.`
      );
    }
    messageCount += conversation.chat_messages?.length || 0;
  });
  if (messageCount > ARCHIVE_LIMITS.messages) {
    throw new Error("conversations.json contains too many messages.");
  }
  rawMemories.forEach((memory, index) =>
    requireRecord(memory, `memories.json[${index}]`)
  );

  const projects = [];
  for (const entry of projectEntries) {
    const project = await jsonEntry(entry.name, undefined);
    projects.push(requireRecord(project, entry.name));
  }

  const primaryUser = users[0] || {};
  const fallbackAccountUuid =
    conversations.find((conversation) => conversation.account?.uuid)?.account?.uuid ||
    (Array.isArray(rawMemories)
      ? rawMemories.find((memory) => memory?.account_uuid)?.account_uuid
      : undefined) ||
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

  const memories = (Array.isArray(rawMemories) ? rawMemories : [])
    .filter((memory) => memory && typeof memory === "object")
    .map((memory) => {
      const projectMemories =
        memory.project_memories &&
        typeof memory.project_memories === "object" &&
        !Array.isArray(memory.project_memories)
          ? Object.fromEntries(
              Object.entries(memory.project_memories).filter(
                ([projectUuid, text]) =>
                  Boolean(projectUuid) &&
                  typeof text === "string"
              )
            )
          : {};
      return {
        account_uuid:
          memory.account_uuid || (accounts.length === 1 ? accounts[0].uuid : undefined),
        conversations_memory:
          typeof memory.conversations_memory === "string"
            ? memory.conversations_memory
            : undefined,
        project_memories: projectMemories,
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
    conversations: conversations.map((conversation) => ({
      ...conversation,
      account_uuid: conversation.account?.uuid || primaryUser.uuid || fallbackAccountUuid
    })),
    projects: projects.map((project) => ({
      ...project,
      account_uuid: project.creator?.uuid || primaryUser.uuid || fallbackAccountUuid
    })),
    memories
  };
}

module.exports = {
  mergeByKey,
  parseArchive
};
