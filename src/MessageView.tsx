import { useState } from "react";
import type { ContentBlock, Message } from "./types";
import MarkdownBlock from "./MarkdownBlock";
import { ChevronIcon, FileIcon } from "./icons";

function JsonPreview({ value }: { value: unknown }) {
  if (value === undefined || value === null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <pre className="structured-preview">{text}</pre>;
}

function ThinkingBlock({ block }: { block: ContentBlock }) {
  const [open, setOpen] = useState(false);
  const canReveal = !block.thinking_hidden && Boolean(block.thinking);
  const status = block.truncated || block.cut_off ? " · 已中断" : "";
  return (
    <div className={`thinking ${open ? "is-open" : ""}`}>
      <button
        className="thinking-toggle"
        onClick={() => canReveal && setOpen((value) => !value)}
        aria-expanded={open}
      >
        <ChevronIcon />
        <span>思考过程{status}</span>
      </button>
      {open && canReveal && (
        <div className="thinking-body">
          <MarkdownBlock text={block.thinking || ""} anchorPrefix="thinking" />
        </div>
      )}
    </div>
  );
}

function ToolBlock({ block }: { block: ContentBlock }) {
  const [open, setOpen] = useState(false);
  const label =
    block.integration_name ||
    block.name ||
    (block.type === "tool_use" ? "使用工具" : "工具结果");
  return (
    <div className={`tool-card ${block.is_error ? "is-error" : ""}`}>
      <button className="tool-card-header" onClick={() => setOpen((value) => !value)}>
        <span className="tool-status-dot" />
        <span>{label}</span>
        <ChevronIcon className={open ? "rotate" : ""} />
      </button>
      {open && (
        <div className="tool-card-body">
          <JsonPreview
            value={
              block.type === "tool_use"
                ? block.input
                : block.display_content || block.structured_content || block.content
            }
          />
        </div>
      )}
    </div>
  );
}

function Content({
  message,
  block,
  blockIndex
}: {
  message: Message;
  block: ContentBlock;
  blockIndex: number;
}) {
  if (block.hidden || block.hidden_in_chat) return null;
  if (block.type === "text" && block.text) {
    return (
      <div className="text-block">
        <MarkdownBlock
          text={block.text}
          anchorPrefix={`heading-${message.uuid}-${blockIndex}`}
        />
        {(block.citations || []).length > 0 && (
          <div className="citations">
            {block.citations?.map((citation, index) =>
              citation.details?.url ? (
                <a
                  href={citation.details.url}
                  target="_blank"
                  rel="noreferrer"
                  key={citation.uuid || index}
                >
                  来源 {index + 1}
                </a>
              ) : null
            )}
          </div>
        )}
      </div>
    );
  }
  if (block.type === "thinking") return <ThinkingBlock block={block} />;
  if (block.type === "tool_use" || block.type === "tool_result") {
    return <ToolBlock block={block} />;
  }
  return null;
}

function extensionOf(name?: string) {
  const match = name?.match(/\.([^.]+)$/);
  return match?.[1]?.toUpperCase() || "FILE";
}

export default function MessageView({ message }: { message: Message }) {
  const blocks = message.content || [];
  const visibleBlockCount = blocks.filter(
    (block) =>
      !block.hidden &&
      !block.hidden_in_chat &&
      ((block.type === "text" && Boolean(block.text)) ||
        block.type === "thinking" ||
        block.type === "tool_use" ||
        block.type === "tool_result")
  ).length;
  const hasFallbackText = blocks.length === 0 && Boolean(message.text);
  const hasVisibleFiles = (message.files || []).length > 0;
  const hasVisibleAttachments = (message.attachments || []).some(
    (attachment) => attachment.extracted_content
  );

  if (
    visibleBlockCount === 0 &&
    !hasFallbackText &&
    !hasVisibleFiles &&
    !hasVisibleAttachments
  ) {
    return null;
  }

  return (
    <article className={`message message-${message.sender}`} id={`message-${message.uuid}`}>
      {message.sender === "human" && <div className="sender-label">你</div>}
      <div className="message-content">
        {visibleBlockCount > 0
          ? blocks.map((block, index) => (
              <Content
                key={`${message.uuid}-${index}`}
                message={message}
                block={block}
                blockIndex={index}
              />
            ))
          : hasFallbackText && message.text && (
              <MarkdownBlock
                text={message.text}
                anchorPrefix={`heading-${message.uuid}-fallback`}
              />
            )}

        {(message.files || []).length > 0 && (
          <div className="file-grid">
            {message.files?.map((file, index) => (
              <div className="file-card" key={file.file_uuid || `${file.file_name}-${index}`}>
                <div className="file-preview">
                  <FileIcon />
                  <span>{extensionOf(file.file_name)}</span>
                </div>
                <div className="file-meta">
                  <strong>{file.file_name || "未命名文件"}</strong>
                  <span>原文件未随导出提供 · 合成预览</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {(message.attachments || []).map((attachment, index) =>
          attachment.extracted_content ? (
            <details className="attachment-text" key={`${attachment.file_name}-${index}`}>
              <summary>{attachment.file_name || "文本附件"}</summary>
              <pre>{attachment.extracted_content}</pre>
            </details>
          ) : null
        )}
      </div>
    </article>
  );
}
