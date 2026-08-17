import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type { ContentBlock, Message } from "./types";
import MarkdownBlock from "./MarkdownBlock";
import { ChevronIcon, FileIcon, TrashIcon } from "./icons";
import {
  buildMessageFilePreviews,
  fileTypeLabel,
  type MessageFilePreview
} from "./messageFiles";
import { findSearchMatchRanges } from "./search";

function JsonPreview({ value }: { value: unknown }) {
  if (value === undefined || value === null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <pre className="structured-preview">{text}</pre>;
}

function PlainTextBlock({
  text,
  matchPrefix,
  searchQuery
}: {
  text: string;
  matchPrefix: string;
  searchQuery?: string;
}) {
  const matches = useMemo(
    () => findSearchMatchRanges(text, searchQuery || ""),
    [searchQuery, text]
  );
  const urls = useMemo(() => {
    const ranges: Array<{ end: number; start: number; url: string }> = [];
    const pattern = /https?:\/\/[^\s<>{}\[\]"']+/giu;
    for (const result of text.matchAll(pattern)) {
      if (result.index === undefined) continue;
      const url = result[0].replace(/[),.;!?，。；！？、]+$/u, "");
      if (!url) continue;
      ranges.push({
        start: result.index,
        end: result.index + url.length,
        url
      });
    }
    return ranges;
  }, [text]);

  const renderRange = (start: number, end: number, prefix: string) => {
    const content: ReactNode[] = [];
    let cursor = start;
    matches.forEach((match, index) => {
      const overlapStart = Math.max(start, match.start);
      const overlapEnd = Math.min(end, match.end);
      if (overlapStart >= overlapEnd) return;
      if (overlapStart > cursor) {
        content.push(text.slice(cursor, overlapStart));
      }
      const matchId = `${matchPrefix}-${index}`;
      content.push(
        <mark
          className="search-highlight"
          data-search-match="true"
          data-search-match-head={overlapStart === match.start ? "true" : undefined}
          data-search-match-id={matchId}
          key={`${prefix}-match-${index}-${overlapStart}`}
        >
          {text.slice(overlapStart, overlapEnd)}
        </mark>
      );
      cursor = overlapEnd;
    });
    if (cursor < end) content.push(text.slice(cursor, end));
    return content;
  };

  const content: ReactNode[] = [];
  let cursor = 0;
  urls.forEach((range, index) => {
    if (range.start > cursor) {
      content.push(
        ...renderRange(cursor, range.start, `plain-${index}-before`)
      );
    }
    content.push(
      <a
        className="human-plain-link"
        href={range.url}
        key={`plain-url-${range.start}`}
        rel="noreferrer"
        target="_blank"
      >
        {renderRange(range.start, range.end, `plain-${index}-url`)}
      </a>
    );
    cursor = range.end;
  });
  if (cursor < text.length) {
    content.push(...renderRange(cursor, text.length, "plain-after"));
  }

  return <div className="human-plain-text">{content}</div>;
}

function ThinkingBlock({
  block,
  anchorPrefix
}: {
  block: ContentBlock;
  anchorPrefix: string;
}) {
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
          <MarkdownBlock
            text={block.thinking || ""}
            anchorPrefix={anchorPrefix}
          />
        </div>
      )}
    </div>
  );
}

function ToolPayload({
  label,
  value
}: {
  label: string;
  value: unknown;
}) {
  if (value === undefined || value === null) return null;
  return (
    <section className="tool-payload">
      <div className="tool-payload-label">{label}</div>
      <JsonPreview value={value} />
    </section>
  );
}

function toolResultValue(block: ContentBlock) {
  return block.display_content ?? block.structured_content ?? block.content;
}

function ToolBlock({
  block,
  pairedResult
}: {
  block: ContentBlock;
  pairedResult?: ContentBlock;
}) {
  const [open, setOpen] = useState(false);
  const label =
    block.integration_name ||
    block.name ||
    (block.type === "tool_use" ? "使用工具" : "工具结果");
  return (
    <div
      className={`tool-card ${
        block.is_error || pairedResult?.is_error ? "is-error" : ""
      }`}
    >
      <button className="tool-card-header" onClick={() => setOpen((value) => !value)}>
        <span className="tool-status-dot" />
        <span>{label}</span>
        <ChevronIcon className={open ? "rotate" : ""} />
      </button>
      {open && (
        <div className="tool-card-body">
          {block.type === "tool_use" ? (
            <>
              <ToolPayload label="输入" value={block.input} />
              {pairedResult && (
                <ToolPayload
                  label={pairedResult.is_error ? "错误结果" : "结果"}
                  value={toolResultValue(pairedResult)}
                />
              )}
            </>
          ) : (
            <JsonPreview value={toolResultValue(block)} />
          )}
        </div>
      )}
    </div>
  );
}

interface IndexedBlock {
  block: ContentBlock;
  index: number;
}

type ContentPart =
  | { kind: "block"; item: IndexedBlock }
  | { kind: "process"; items: IndexedBlock[] };

function isRenderableBlock(block: ContentBlock) {
  if (block.hidden || block.hidden_in_chat) return false;
  return (
    (block.type === "text" && Boolean(block.text)) ||
    (block.type === "thinking" &&
      !block.thinking_hidden &&
      Boolean(block.thinking)) ||
    block.type === "tool_use" ||
    block.type === "tool_result"
  );
}

function isProcessBlock(block: ContentBlock) {
  return (
    block.type === "thinking" ||
    block.type === "tool_use" ||
    block.type === "tool_result"
  );
}

function groupContentBlocks(blocks: ContentBlock[]): ContentPart[] {
  const visibleBlocks = blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => isRenderableBlock(block));
  const parts: ContentPart[] = [];

  for (let index = 0; index < visibleBlocks.length; ) {
    const item = visibleBlocks[index];
    if (!isProcessBlock(item.block)) {
      parts.push({ kind: "block", item });
      index += 1;
      continue;
    }

    const items: IndexedBlock[] = [];
    while (
      index < visibleBlocks.length &&
      isProcessBlock(visibleBlocks[index].block)
    ) {
      items.push(visibleBlocks[index]);
      index += 1;
    }

    if (items.length === 1) {
      parts.push({ kind: "block", item: items[0] });
    } else {
      parts.push({ kind: "process", items });
    }
  }

  return parts;
}

type ProcessStep =
  | { kind: "thinking"; item: IndexedBlock }
  | { kind: "tool"; item: IndexedBlock; result?: IndexedBlock };

function mergeProcessSteps(items: IndexedBlock[]): ProcessStep[] {
  const steps: ProcessStep[] = [];

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item.block.type === "thinking") {
      steps.push({ kind: "thinking", item });
      continue;
    }

    if (item.block.type === "tool_use") {
      const possibleResult = items[index + 1];
      const isMatchingResult =
        possibleResult?.block.type === "tool_result" &&
        Boolean(item.block.id) &&
        possibleResult.block.tool_use_id === item.block.id;
      steps.push({
        kind: "tool",
        item,
        result: isMatchingResult ? possibleResult : undefined
      });
      if (isMatchingResult) index += 1;
      continue;
    }

    steps.push({ kind: "tool", item });
  }

  return steps;
}

function ProcessGroup({
  message,
  items
}: {
  message: Message;
  items: IndexedBlock[];
}) {
  const [open, setOpen] = useState(false);
  const steps = mergeProcessSteps(items);
  const thinkingCount = steps.filter(
    (step) => step.kind === "thinking"
  ).length;
  const toolCount = steps.length - thinkingCount;
  const label =
    thinkingCount > 0 && toolCount > 0
      ? "推理过程与工具调用"
      : thinkingCount > 0
        ? "推理过程"
        : "工具调用";
  const bodyId = `process-${message.uuid}-${items[0].index}`;

  return (
    <div className={`process-group ${open ? "is-open" : ""}`}>
      <button
        className="process-group-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={bodyId}
      >
        <ChevronIcon />
        <span className="process-group-title">{label}</span>
        <span className="process-group-count">
          {[
            thinkingCount > 0 ? `${thinkingCount} 段思考` : "",
            toolCount > 0 ? `${toolCount} 次工具调用` : ""
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </button>
      {open && (
        <div className="process-group-body" id={bodyId}>
          {steps.map((step) =>
            step.kind === "tool" ? (
              <ToolBlock
                key={`${message.uuid}-${step.item.index}`}
                block={step.item.block}
                pairedResult={step.result?.block}
              />
            ) : (
              <Content
                key={`${message.uuid}-${step.item.index}`}
                message={message}
                block={step.item.block}
                blockIndex={step.item.index}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

function Content({
  message,
  block,
  blockIndex,
  plainText = false,
  searchQuery
}: {
  message: Message;
  block: ContentBlock;
  blockIndex: number;
  plainText?: boolean;
  searchQuery?: string;
}) {
  if (block.hidden || block.hidden_in_chat) return null;
  if (block.type === "text" && block.text) {
    return (
      <div className="text-block">
        {plainText ? (
          <PlainTextBlock
            text={block.text}
            matchPrefix={`heading-${message.uuid}-${blockIndex}`}
            searchQuery={searchQuery}
          />
        ) : (
          <MarkdownBlock
            text={block.text}
            anchorPrefix={`heading-${message.uuid}-${blockIndex}`}
            searchQuery={searchQuery}
            citations={block.citations}
          />
        )}
      </div>
    );
  }
  if (block.type === "thinking") {
    return (
      <ThinkingBlock
        block={block}
        anchorPrefix={`thinking-${message.uuid}-${blockIndex}`}
      />
    );
  }
  if (block.type === "tool_use" || block.type === "tool_result") {
    return <ToolBlock block={block} />;
  }
  return null;
}

function FilePreviewCard({ file }: { file: MessageFilePreview }) {
  const description =
    file.kind === "generated"
      ? "Claude 生成文件 · 文件本体未包含在导出中"
      : "原文件未随导出提供 · 合成预览";

  return (
    <div className="file-card">
      <div className="file-preview">
        <FileIcon />
        <span>{fileTypeLabel(file)}</span>
      </div>
      <div className="file-meta">
        <strong>{file.fileName || "未命名文件"}</strong>
        <span>{description}</span>
      </div>
    </div>
  );
}

export default function MessageView({
  message,
  highlightQuery,
  onDelete
}: {
  message: Message;
  highlightQuery?: string;
  onDelete?: (message: Message) => void;
}) {
  const isHuman = message.sender === "human";
  const [humanMessageExpanded, setHumanMessageExpanded] = useState(false);
  const [humanMessageOverflows, setHumanMessageOverflows] = useState(false);
  const humanMessageClipRef = useRef<HTMLDivElement>(null);
  const humanMessageBodyRef = useRef<HTMLDivElement>(null);
  const blocks = message.content || [];
  const contentParts = useMemo(() => groupContentBlocks(blocks), [blocks]);
  const filePreviews = useMemo(
    () => buildMessageFilePreviews(message),
    [message]
  );
  const visibleBlockCount = contentParts.reduce(
    (count, part) =>
      count + (part.kind === "process" ? part.items.length : 1),
    0
  );
  const hasFallbackText = blocks.length === 0 && Boolean(message.text);
  const hasVisibleFiles = filePreviews.length > 0;
  const hasVisibleAttachments = (message.attachments || []).some(
    (attachment) => attachment.extracted_content
  );
  const forceHumanMessageOpen = isHuman && Boolean(highlightQuery);
  const humanMessageCollapsed =
    isHuman && !humanMessageExpanded && !forceHumanMessageOpen;
  const fileGrid =
    filePreviews.length > 0 ? (
      <div className="file-grid">
        {filePreviews.map((file) => (
          <FilePreviewCard file={file} key={file.key} />
        ))}
      </div>
    ) : null;

  useEffect(() => {
    setHumanMessageExpanded(false);
    setHumanMessageOverflows(false);
  }, [message.uuid]);

  useLayoutEffect(() => {
    if (!humanMessageCollapsed) return;

    const clip = humanMessageClipRef.current;
    const body = humanMessageBodyRef.current;
    if (!clip || !body) return;

    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      setHumanMessageOverflows(body.scrollHeight > clip.clientHeight + 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(clip);
    observer.observe(body);
    void document.fonts?.ready.then(measure);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [humanMessageCollapsed, visibleBlockCount, hasFallbackText]);

  if (
    visibleBlockCount === 0 &&
    !hasFallbackText &&
    !hasVisibleFiles &&
    !hasVisibleAttachments
  ) {
    return null;
  }

  const renderedMessageBody = (
    <>
      {visibleBlockCount > 0
        ? contentParts.map((part) =>
            part.kind === "process" ? (
              <ProcessGroup
                key={`process-${message.uuid}-${part.items[0].index}`}
                message={message}
                items={part.items}
              />
            ) : (
              <Content
                key={`${message.uuid}-${part.item.index}`}
                message={message}
                block={part.item.block}
                blockIndex={part.item.index}
                plainText={isHuman}
                searchQuery={highlightQuery}
              />
            )
          )
        : hasFallbackText && message.text && (
            isHuman ? (
              <PlainTextBlock
                text={message.text}
                matchPrefix={`heading-${message.uuid}-fallback`}
                searchQuery={highlightQuery}
              />
            ) : (
              <MarkdownBlock
                text={message.text}
                anchorPrefix={`heading-${message.uuid}-fallback`}
                searchQuery={highlightQuery}
              />
            )
          )}
    </>
  );

  return (
    <article
      className={`message message-${message.sender} ${
        highlightQuery ? "message-search-target" : ""
      }`}
      id={`message-${message.uuid}`}
    >
      <div className="message-content">
        {isHuman && onDelete && (
          <button
            type="button"
            className="human-message-delete"
            onClick={() => onDelete(message)}
            aria-label="从阅读器中删除这个问题及对应回答"
            title="删除这个问题及对应回答"
          >
            <TrashIcon />
          </button>
        )}
        {isHuman ? (
          <>
            <div
              ref={humanMessageClipRef}
              id={`human-message-${message.uuid}`}
              className={`human-message-clip ${
                humanMessageCollapsed ? "is-collapsed" : ""
              } ${humanMessageOverflows ? "has-overflow" : ""}`}
            >
              <div ref={humanMessageBodyRef} className="human-message-body">
                {renderedMessageBody}
              </div>
            </div>
            {humanMessageOverflows && !forceHumanMessageOpen && (
              <button
                type="button"
                className="human-message-toggle"
                aria-controls={`human-message-${message.uuid}`}
                aria-expanded={humanMessageExpanded}
                onClick={() => setHumanMessageExpanded((value) => !value)}
              >
                {humanMessageExpanded ? "Show less" : "Show more"}
              </button>
            )}
          </>
        ) : (
          renderedMessageBody
        )}

        {message.sender === "human" && fileGrid}

        {(message.attachments || []).map((attachment, index) =>
          attachment.extracted_content ? (
            <details className="attachment-text" key={`${attachment.file_name}-${index}`}>
              <summary>{attachment.file_name || "文本附件"}</summary>
              <pre>{attachment.extracted_content}</pre>
            </details>
          ) : null
        )}

        {message.sender === "assistant" && fileGrid}
      </div>
    </article>
  );
}
