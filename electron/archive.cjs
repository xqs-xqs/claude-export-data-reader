const { createHash } = require("node:crypto");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const JSZip = require("jszip");

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
  const buffer = await readFile(filePath);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const importedAt = new Date().toISOString();
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });

  async function jsonEntry(name, fallback) {
    const entry = zip.file(name);
    if (!entry) return fallback;
    return JSON.parse(await entry.async("string"));
  }

  const users = await jsonEntry("users.json", []);
  const conversations = await jsonEntry("conversations.json", []);
  const rawMemories = await jsonEntry("memories.json", []);
  const projectEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && /^projects\/[^/]+\.json$/i.test(entry.name)
  );
  const projects = [];
  for (const entry of projectEntries) {
    projects.push(JSON.parse(await entry.async("string")));
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
