const assert = require("node:assert/strict");
const { mkdir, mkdtemp, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const JSZip = require("jszip");
const {
  parseArchive,
  parseSplitArchiveBatch
} = require("../electron/archive.cjs");

const account = {
  uuid: "account-1",
  full_name: "Test User",
  email_address: "test@example.invalid"
};
const project = {
  uuid: "project-1",
  creator: { uuid: account.uuid },
  name: "Test project",
  docs: []
};
const memory = {
  account_uuid: account.uuid,
  conversations_memory: "Legacy account memory",
  project_memories: { "project-1": "Project memory" },
  memory_files: [
    {
      path: "/topics/testing.md",
      content: "---\nname: testing\n---\n- regression coverage"
    }
  ]
};

function conversation(uuid, text, accountUuid = account.uuid) {
  return {
    uuid,
    account: { uuid: accountUuid },
    name: text,
    created_at: "2026-08-22T04:00:00Z",
    updated_at: "2026-08-22T04:01:00Z",
    chat_messages: [
      {
        uuid: uuid + "-message",
        sender: "human",
        text,
        content: [{ type: "text", text }]
      }
    ]
  };
}

async function writeZip(filePath, entries) {
  const zip = new JSZip();
  for (const [name, value] of Object.entries(entries)) {
    zip.file(name, typeof value === "string" ? value : JSON.stringify(value));
  }
  await writeFile(
    filePath,
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
  );
}

async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), "claude-reader-import-"));
  try {
    const oldPath = path.join(directory, "legacy.zip");
    await writeZip(oldPath, {
      "users.json": [account],
      "conversations.json": [conversation("legacy-conversation", "Legacy")],
      "memories.json": [memory],
      "projects/project-1.json": project
    });
    const legacy = await parseArchive(oldPath);
    assert.equal(legacy.accounts.length, 1);
    assert.equal(legacy.conversations.length, 1);
    assert.equal(legacy.projects.length, 1);
    assert.equal(legacy.memories.length, 1);
    assert.equal(legacy.conversations[0].account_uuid, account.uuid);

    const filenames = [
      "light_metadata-000.zip",
      "projects-000.zip",
      "memories-000.zip",
      "conversations-000.zip",
      "conversations-001.zip"
    ];
    const zipPaths = filenames.map((filename) => path.join(directory, filename));
    await writeZip(zipPaths[0], {
      "users.json": [account],
      "login_history.json": "{ login_events: [{ ip_address: sensitive }]"
    });
    await writeZip(zipPaths[1], {
      "projects/project-1.json": project
    });
    await writeZip(zipPaths[2], {
      "memories/account-1.json": memory
    });
    await writeZip(zipPaths[3], {
      "conversations.json": [conversation("conversation-1", "First")]
    });
    await writeZip(zipPaths[4], {
      "conversations.json": [conversation("conversation-2", "Second")]
    });

    const parsed = await parseSplitArchiveBatch([...zipPaths].reverse());
    assert.equal(parsed.accounts.length, 1);
    assert.deepEqual(
      parsed.conversations.map((item) => item.uuid),
      ["conversation-1", "conversation-2"]
    );
    assert.equal(parsed.projects.length, 1);
    assert.equal(parsed.memories.length, 1);
    assert.equal(parsed.memories[0].memory_files.length, 1);
    assert.equal(parsed.conversations[0].account_uuid, account.uuid);
    const serialized = JSON.stringify(parsed);
    assert.equal(serialized.includes("login_events"), false);
    assert.equal(serialized.includes("ip_address"), false);

    const reordered = await parseSplitArchiveBatch(zipPaths);
    assert.equal(reordered.sha256, parsed.sha256);

    await assert.rejects(
      () =>
        parseSplitArchiveBatch(
          zipPaths.filter((filePath) => !filePath.endsWith("memories-000.zip"))
        ),
      /missing the memories ZIP/
    );

    const partGapDirectory = path.join(directory, "part-gap");
    await mkdir(partGapDirectory);
    const partGapPath = path.join(partGapDirectory, "conversations-002.zip");
    await writeZip(partGapPath, {
      "conversations.json": [conversation("conversation-2", "Second")]
    });
    await assert.rejects(
      () =>
        parseSplitArchiveBatch(
          zipPaths.map((filePath, index) => (index === 4 ? partGapPath : filePath))
        ),
      /parts must be continuous from 000/
    );

    await assert.rejects(
      () => parseSplitArchiveBatch([...zipPaths, zipPaths[3]]),
      /repeats a category part number/
    );
    await assert.rejects(
      () => parseSplitArchiveBatch([zipPaths[0], oldPath]),
      /新版 Claude 导出需要同时选择/
    );

    const foreignDirectory = path.join(directory, "foreign-account");
    await mkdir(foreignDirectory);
    const foreignPath = path.join(foreignDirectory, "conversations-000.zip");
    await writeZip(foreignPath, {
      "conversations.json": [
        conversation("foreign-conversation", "Foreign", "account-2")
      ]
    });
    await assert.rejects(
      () =>
        parseSplitArchiveBatch(
          zipPaths.map((filePath, index) => (index === 3 ? foreignPath : filePath))
        ),
      /not declared by light_metadata/
    );

    const missingConversationDirectory = path.join(directory, "missing-conversation-account");
    await mkdir(missingConversationDirectory);
    const missingConversationPath = path.join(
      missingConversationDirectory,
      "conversations-000.zip"
    );
    const missingConversation = conversation(
      "missing-account-conversation",
      "Missing account"
    );
    delete missingConversation.account;
    await writeZip(missingConversationPath, {
      "conversations.json": [missingConversation]
    });
    await assert.rejects(
      () =>
        parseSplitArchiveBatch(
          zipPaths.map((filePath, index) =>
            index === 3 ? missingConversationPath : filePath
          )
        ),
      /does not declare an account UUID/
    );

    const conflictingDirectory = path.join(directory, "conflicting-account");
    await mkdir(conflictingDirectory);
    const conflictingPath = path.join(
      conflictingDirectory,
      "conversations-000.zip"
    );
    const conflictingConversation = conversation(
      "conflicting-account-conversation",
      "Conflicting account"
    );
    conflictingConversation.account_uuid = "account-2";
    await writeZip(conflictingPath, {
      "conversations.json": [conflictingConversation]
    });
    await assert.rejects(
      () =>
        parseSplitArchiveBatch(
          zipPaths.map((filePath, index) =>
            index === 3 ? conflictingPath : filePath
          )
        ),
      /conflicting account UUIDs/
    );

    const missingProjectDirectory = path.join(directory, "missing-project-account");
    await mkdir(missingProjectDirectory);
    const missingProjectPath = path.join(
      missingProjectDirectory,
      "projects-000.zip"
    );
    const missingProject = { ...project };
    delete missingProject.creator;
    await writeZip(missingProjectPath, {
      "projects/project-1.json": missingProject
    });
    await assert.rejects(
      () =>
        parseSplitArchiveBatch(
          zipPaths.map((filePath, index) =>
            index === 1 ? missingProjectPath : filePath
          )
        ),
      /does not declare an account UUID/
    );

    const missingMemoryDirectory = path.join(directory, "missing-memory-account");
    await mkdir(missingMemoryDirectory);
    const missingMemoryPath = path.join(
      missingMemoryDirectory,
      "memories-000.zip"
    );
    const missingMemory = { ...memory };
    delete missingMemory.account_uuid;
    await writeZip(missingMemoryPath, {
      "memories/account-1.json": missingMemory
    });
    await assert.rejects(
      () =>
        parseSplitArchiveBatch(
          zipPaths.map((filePath, index) =>
            index === 2 ? missingMemoryPath : filePath
          )
        ),
      /does not declare an account UUID/
    );

    process.stdout.write("Import compatibility tests passed.\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(String(error.stack || error) + "\n");
  process.exitCode = 1;
});
