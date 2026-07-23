import type { Conversation, HeadingEntry, Message } from "./types";
import { parseHeadingLines } from "./headings";

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

function headingsFromText(
  text: string,
  prefix: string
): HeadingEntry[] {
  return parseHeadingLines(text).map((heading, index) => ({
    id: `${prefix}-${index}`,
    level: heading.level,
    text: heading.text
  }));
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
