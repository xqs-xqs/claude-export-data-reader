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
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });

  async function jsonEntry(name, fallback) {
    const entry = zip.file(name);
    if (!entry) return fallback;
    return JSON.parse(await entry.async("string"));
  }

  const users = await jsonEntry("users.json", []);
  const conversations = await jsonEntry("conversations.json", []);
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

  return {
    sha256,
    filename: path.basename(filePath),
    importedAt: new Date().toISOString(),
    accounts,
    conversations: conversations.map((conversation) => ({
      ...conversation,
      account_uuid: conversation.account?.uuid || primaryUser.uuid || fallbackAccountUuid
    })),
    projects: projects.map((project) => ({
      ...project,
      account_uuid: project.creator?.uuid || primaryUser.uuid || fallbackAccountUuid
    }))
  };
}

module.exports = {
  mergeByKey,
  parseArchive
};
