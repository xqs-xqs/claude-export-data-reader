import type { ContentBlock, Message } from "./types";

export interface MessageFilePreview {
  fileName?: string;
  fileUuid?: string;
  key: string;
  kind: "attached" | "generated";
  mimeType?: string;
  source: "attachment" | "message" | "present_files";
}

const MIME_TYPE_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/zip": "ZIP",
  "text/html": "HTML",
  "text/markdown": "MD",
  "text/plain": "TXT",
  "text/x-python": "PY"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isHidden(block: ContentBlock) {
  return block.hidden === true || block.hidden_in_chat === true;
}

function isPresentFilesBlock(block: ContentBlock) {
  return block.name === "present_files";
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function baseName(filePath?: string) {
  if (!filePath) return undefined;
  const segments = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments.at(-1) || undefined;
}

function normalizedName(fileName?: string) {
  return fileName?.trim().toLowerCase();
}

export function fileTypeLabel(file: MessageFilePreview) {
  const extension = file.fileName?.match(/\.([^.]+)$/)?.[1];
  if (extension) return extension.toUpperCase();
  if (file.mimeType && MIME_TYPE_LABELS[file.mimeType]) {
    return MIME_TYPE_LABELS[file.mimeType];
  }
  return "FILE";
}

export function buildMessageFilePreviews(message: Message) {
  const previews: MessageFilePreview[] = [];
  const explicitIds = new Set<string>();
  const explicitNames = new Set<string>();

  for (const [index, file] of (message.files || []).entries()) {
    if (file.file_uuid) explicitIds.add(file.file_uuid);
    const nameKey = normalizedName(file.file_name);
    if (nameKey) explicitNames.add(nameKey);

    previews.push({
      fileName: file.file_name,
      fileUuid: file.file_uuid,
      key: `message-${file.file_uuid || file.file_name || index}-${index}`,
      kind: message.sender === "assistant" ? "generated" : "attached",
      source: "message"
    });
  }

  if (message.sender !== "assistant") return previews;

  for (const [index, attachment] of (message.attachments || []).entries()) {
    const nameKey = normalizedName(attachment.file_name);
    if (!attachment.file_name || (nameKey && explicitNames.has(nameKey))) {
      continue;
    }
    if (nameKey) explicitNames.add(nameKey);

    previews.push({
      fileName: attachment.file_name,
      key: `attachment-${attachment.file_name}-${index}`,
      kind: "generated",
      mimeType: attachment.file_type,
      source: "attachment"
    });
  }

  const blocks = message.content || [];
  const suppressedToolIds = new Set<string>();
  const handledToolIds = new Set<string>();
  const generatedIds = new Set<string>();
  const generatedNames = new Set<string>();
  const generatedPaths = new Set<string>();

  for (const block of blocks) {
    if (!isPresentFilesBlock(block)) continue;
    if (!isHidden(block) && !(block.type === "tool_result" && block.is_error)) {
      continue;
    }

    const toolId =
      block.type === "tool_use" ? block.id : block.tool_use_id;
    if (toolId) suppressedToolIds.add(toolId);
  }

  const addGeneratedFile = ({
    fileName,
    filePath,
    fileUuid,
    key,
    mimeType
  }: {
    fileName?: string;
    filePath?: string;
    fileUuid?: string;
    key: string;
    mimeType?: string;
  }) => {
    const resolvedName = baseName(filePath) || fileName;
    const nameKey = normalizedName(resolvedName);
    const pathKey = filePath?.replace(/\\/g, "/").toLowerCase();
    if (fileUuid && explicitIds.has(fileUuid)) return;
    if (nameKey && explicitNames.has(nameKey)) return;
    if (fileUuid && generatedIds.has(fileUuid)) return;
    if (pathKey && generatedPaths.has(pathKey)) return;
    if (!fileUuid && !pathKey && nameKey && generatedNames.has(nameKey)) return;

    if (fileUuid) generatedIds.add(fileUuid);
    if (pathKey) generatedPaths.add(pathKey);
    if (nameKey) generatedNames.add(nameKey);
    const identity = fileUuid || pathKey || nameKey || key;

    previews.push({
      fileName: resolvedName,
      fileUuid,
      key: `presented-${identity}`,
      kind: "generated",
      mimeType,
      source: "present_files"
    });
  };

  for (const [blockIndex, block] of blocks.entries()) {
    if (
      block.type !== "tool_result" ||
      !isPresentFilesBlock(block) ||
      isHidden(block) ||
      block.is_error ||
      (block.tool_use_id && suppressedToolIds.has(block.tool_use_id))
    ) {
      continue;
    }

    let foundResource = false;
    if (Array.isArray(block.content)) {
      for (const [resourceIndex, value] of block.content.entries()) {
        if (!isRecord(value) || value.type !== "local_resource") continue;
        const filePath = stringField(value, "file_path");
        const fileName = stringField(value, "name");
        if (!filePath && !fileName) continue;

        foundResource = true;
        addGeneratedFile({
          fileName,
          filePath,
          fileUuid: stringField(value, "uuid"),
          key: `${blockIndex}-${resourceIndex}`,
          mimeType: stringField(value, "mime_type")
        });
      }
    }

    if (foundResource && block.tool_use_id) {
      handledToolIds.add(block.tool_use_id);
    }
  }

  for (const [blockIndex, block] of blocks.entries()) {
    if (
      block.type !== "tool_use" ||
      !isPresentFilesBlock(block) ||
      isHidden(block) ||
      (block.id && suppressedToolIds.has(block.id)) ||
      (block.id && handledToolIds.has(block.id)) ||
      !isRecord(block.input) ||
      !Array.isArray(block.input.filepaths)
    ) {
      continue;
    }

    for (const [pathIndex, value] of block.input.filepaths.entries()) {
      if (typeof value !== "string" || !value.trim()) continue;
      addGeneratedFile({
        filePath: value,
        key: `fallback-${blockIndex}-${pathIndex}`
      });
    }
  }

  return previews;
}
