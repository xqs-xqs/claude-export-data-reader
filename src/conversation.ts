import type { Conversation, HeadingEntry, Message } from "./types";

export function currentBranch(messages: Message[]): Message[] {
  if (messages.length < 2) return messages;
  const byId = new Map(messages.map((message) => [message.uuid, message]));
  let cursor: Message | undefined = messages[messages.length - 1];
  const branch: Message[] = [];
  const visited = new Set<string>();

  while (cursor && !visited.has(cursor.uuid)) {
    branch.push(cursor);
    visited.add(cursor.uuid);
    cursor = cursor.parent_message_uuid
      ? byId.get(cursor.parent_message_uuid)
      : undefined;
  }
  return branch.reverse();
}

export function visibleMessages(conversation?: Conversation): Message[] {
  if (!conversation) return [];
  return currentBranch(conversation.chat_messages || []);
}

function cleanHeading(text: string) {
  return text
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
}

function headingsFromText(
  text: string,
  prefix: string
): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  let headingIndex = 0;
  let fence: string | undefined;

  for (const line of text.split(/\r?\n/)) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      fence = fence === marker ? undefined : fence || marker;
      continue;
    }
    if (fence) continue;

    const match = /^(#{1,4})\s+(.+?)\s*#*$/.exec(line);
    if (!match) continue;
    headings.push({
      id: `${prefix}-${headingIndex}`,
      level: match[1].length,
      text: cleanHeading(match[2])
    });
    headingIndex += 1;
  }
  return headings;
}

export function extractHeadings(messages: Message[]): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  for (const message of messages) {
    const blocks = message.content || [];
    let renderedTextBlock = false;
    blocks.forEach((block, blockIndex) => {
      if (
        block.type !== "text" ||
        block.hidden ||
        block.hidden_in_chat ||
        !block.text
      ) {
        return;
      }
      renderedTextBlock = true;
      headings.push(
        ...headingsFromText(
          block.text,
          `heading-${message.uuid}-${blockIndex}`
        )
      );
    });
    if (!renderedTextBlock && message.text) {
      headings.push(
        ...headingsFromText(message.text, `heading-${message.uuid}-fallback`)
      );
    }
  }
  return headings;
}

export function dateLabel(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric"
  }).format(date);
}
