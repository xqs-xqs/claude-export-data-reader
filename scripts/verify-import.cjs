const { parseArchive } = require("../electron/archive.cjs");

async function main() {
  const archivePath = process.argv[2];
  if (!archivePath) {
    throw new Error("Usage: node scripts/verify-import.cjs <export.zip>");
  }
  const parsed = await parseArchive(archivePath);
  const messages = parsed.conversations.flatMap(
    (conversation) => conversation.chat_messages || []
  );
  const blocks = messages.flatMap((message) => message.content || []);
  const files = messages.flatMap((message) => message.files || []);
  const attachments = messages.flatMap((message) => message.attachments || []);

  process.stdout.write(
    JSON.stringify(
      {
        sha256: parsed.sha256,
        accounts: parsed.accounts.length,
        conversations: parsed.conversations.length,
        messages: messages.length,
        contentBlocks: blocks.length,
        files: files.length,
        attachments: attachments.length,
        projects: parsed.projects.length
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
