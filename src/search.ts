import type { Conversation, Message } from "./types";
import { visibleMessages } from "./conversation";
import { hiddenConversationKey } from "./hiddenItems";
import { protectMathInMarkdown } from "./math";

export interface SearchMessageMatch {
  message: Message;
  snippet: string;
}

export interface SearchConversationGroup {
  conversation: Conversation;
  key: string;
  messageMatches: SearchMessageMatch[];
  titleMatch: boolean;
}

export interface ConversationSearchIndex {
  conversation: Conversation;
  key: string;
  messages: Array<{
    message: Message;
    normalizedText: string;
    text: string;
  }>;
  normalizedTitle: string;
}

export interface SearchResults {
  groups: SearchConversationGroup[];
  shownMatches: number;
  totalMatches: number;
  truncated: boolean;
}

export interface SearchTextRange {
  end: number;
  start: number;
}

function canonicalizeSearchText(value: string) {
  const positions: SearchTextRange[] = [];
  let normalized = "";
  let pendingWhitespace: SearchTextRange | undefined;

  for (let offset = 0; offset < value.length; ) {
    const codePoint = value.codePointAt(offset);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    const end = offset + character.length;

    if (/\s/u.test(character)) {
      if (normalized) {
        pendingWhitespace = pendingWhitespace
          ? { start: pendingWhitespace.start, end }
          : { start: offset, end };
      }
      offset = end;
      continue;
    }

    if (pendingWhitespace) {
      normalized += " ";
      positions.push(pendingWhitespace);
      pendingWhitespace = undefined;
    }

    const foldedCharacter = character.toLocaleLowerCase();
    normalized += foldedCharacter;
    for (let index = 0; index < foldedCharacter.length; index += 1) {
      positions.push({ start: offset, end });
    }
    offset = end;
  }

  return { normalized, positions };
}

export function normalizeSearchText(value: string) {
  return canonicalizeSearchText(value).normalized;
}

export function findSearchMatchRanges(value: string, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const target = canonicalizeSearchText(value);
  const ranges: SearchTextRange[] = [];
  let matchIndex = target.normalized.indexOf(normalizedQuery);

  while (matchIndex >= 0) {
    const start = target.positions[matchIndex];
    const end = target.positions[matchIndex + normalizedQuery.length - 1];
    if (start && end) {
      ranges.push({ start: start.start, end: end.end });
    }
    matchIndex = target.normalized.indexOf(
      normalizedQuery,
      matchIndex + normalizedQuery.length
    );
  }

  return ranges;
}

let htmlEntityDecoder: HTMLTextAreaElement | undefined;

function decodeHtmlEntities(value: string) {
  if (typeof document === "undefined") {
    return value
      .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
        String.fromCodePoint(Number.parseInt(code, 16))
      )
      .replace(/&#(\d+);/g, (_match, code: string) =>
        String.fromCodePoint(Number(code))
      )
      .replace(
        /&(amp|lt|gt|quot|apos);/gi,
        (_match, entity: string) =>
          ({
            amp: "&",
            apos: "'",
            gt: ">",
            lt: "<",
            quot: '"'
          })[entity.toLocaleLowerCase()] || _match
      );
  }

  htmlEntityDecoder ||= document.createElement("textarea");
  htmlEntityDecoder.innerHTML = value;
  return htmlEntityDecoder.value;
}

function plainMessageText(value: string) {
  const protectedMath = protectMathInMarkdown(value);
  let searchableSource = protectedMath.markdown;
  for (const formula of protectedMath.formulas) {
    searchableSource = searchableSource.replaceAll(formula.token, " ");
  }

  const codeSegments: string[] = [];
  const protectCode = (_match: string, code: string) => {
    const index = codeSegments.push(code) - 1;
    return `\uE000${index}\uE001`;
  };

  const plain = searchableSource
    .replace(/```[^\r\n]*\r?\n([\s\S]*?)```/g, protectCode)
    .replace(/~~~[^\r\n]*\r?\n([\s\S]*?)~~~/g, protectCode)
    .replace(/`([^`\r\n]+)`/g, protectCode)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<mailto:([^<>\s]+)>/gi, "$1")
    .replace(/<([a-z][a-z0-9+.-]{1,31}:[^<>\s]+)>/gi, "$1")
    .replace(/<([^<>\s@]+@[^<>\s@]+)>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\*\*([^*\r\n]+)\*\*/g, "$1")
    .replace(/\*([^*\r\n]+)\*/g, "$1")
    .replace(/~~([^~\r\n]+)~~/g, "$1")
    .replace(/^ {0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^ {0,3}>[ \t]?/gm, "");

  return decodeHtmlEntities(plain)
    .replace(/\uE000(\d+)\uE001/g, (_match, index: string) => {
      return codeSegments[Number(index)] || "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function visibleMessageText(message: Message) {
  const blocks = message.content || [];
  if (!blocks.length) return message.text || "";

  return blocks
    .filter(
      (block) =>
        block.type === "text" &&
        !block.hidden &&
        !block.hidden_in_chat &&
        block.text
    )
    .map((block) => block.text || "")
    .join("\n\n");
}

function conversationTimestamp(conversation: Conversation) {
  return new Date(
    conversation.updated_at || conversation.created_at || 0
  ).getTime();
}

export function sortConversationsByRecency(
  conversations: Conversation[]
) {
  return [...conversations].sort(
    (left, right) =>
      conversationTimestamp(right) - conversationTimestamp(left)
  );
}

export function conversationDisplayTitle(conversation: Conversation) {
  return conversation.name?.trim() || "未命名会话";
}

export function buildConversationSearchIndex(
  conversations: Conversation[],
  hiddenQuestionIdsByConversation: Readonly<Record<string, readonly string[]>> = {}
): ConversationSearchIndex[] {
  return sortConversationsByRecency(conversations).map((conversation) => ({
      conversation,
      key: `${conversation.account_uuid}:${conversation.uuid}`,
      normalizedTitle: normalizeSearchText(
        conversationDisplayTitle(conversation)
      ),
      messages: visibleMessages(
        conversation,
        new Set(
          hiddenQuestionIdsByConversation[
            hiddenConversationKey(
              conversation.account_uuid,
              conversation.uuid
            )
          ] || []
        )
      )
        .map((message) => {
          const text = plainMessageText(visibleMessageText(message));
          return {
            message,
            text,
            normalizedText: normalizeSearchText(text)
          };
        })
        .filter((entry) => entry.text)
    }));
}

function searchSnippet(text: string, normalizedQuery: string) {
  const match = findSearchMatchRanges(text, normalizedQuery)[0];
  if (!match) return Array.from(text).slice(0, 96).join("");

  const before = Array.from(text.slice(0, match.start)).slice(-34).join("");
  const after = Array.from(text.slice(match.end)).slice(0, 64).join("");
  let start = match.start - before.length;
  let end = match.end + after.length;

  if (start > 0) {
    const nextSpace = text.indexOf(" ", start);
    if (nextSpace >= 0 && nextSpace < match.start) start = nextSpace + 1;
  }
  if (end < text.length) {
    const previousSpace = text.lastIndexOf(" ", end);
    if (previousSpace > match.end) {
      end = previousSpace;
    }
  }

  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${
    end < text.length ? "…" : ""
  }`;
}

export function searchConversationIndex(
  index: ConversationSearchIndex[],
  query: string,
  maximumMessageMatches = 250
): SearchResults {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return {
      groups: [],
      shownMatches: 0,
      totalMatches: 0,
      truncated: false
    };
  }

  const groups: SearchConversationGroup[] = [];
  let shownMessageMatches = 0;
  let shownMatches = 0;
  let totalMatches = 0;

  for (const entry of index) {
    const titleMatch = entry.normalizedTitle.includes(normalizedQuery);
    const messageMatches: SearchMessageMatch[] = [];
    if (titleMatch) {
      totalMatches += 1;
      shownMatches += 1;
    }
    for (const { message, normalizedText, text } of entry.messages) {
      if (!normalizedText.includes(normalizedQuery)) continue;
      totalMatches += 1;
      if (shownMessageMatches >= maximumMessageMatches) continue;
      shownMessageMatches += 1;
      shownMatches += 1;
      messageMatches.push({
        message,
        snippet: searchSnippet(text, normalizedQuery)
      });
    }

    if (!titleMatch && !messageMatches.length) continue;
    groups.push({
      conversation: entry.conversation,
      key: entry.key,
      messageMatches,
      titleMatch
    });
  }

  return {
    groups,
    shownMatches,
    totalMatches,
    truncated: shownMatches < totalMatches
  };
}
