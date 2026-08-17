import type { Conversation, HeadingEntry, Message } from "./types";
import { parseHeadingCandidates } from "./headings";
import type { ParsedHeading } from "./headings";

const QUESTION_MIN_LENGTH = 24;
const QUESTION_MAX_LENGTH = 48;

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

function isRenderableBlock(message: Message) {
  const blocks = message.content || [];
  if (!blocks.length) return Boolean(message.text);
  return blocks.some(
    (block) =>
      !block.hidden &&
      !block.hidden_in_chat &&
      ((block.type === "text" && Boolean(block.text)) ||
        (block.type === "thinking" &&
          !block.thinking_hidden &&
          Boolean(block.thinking)) ||
        block.type === "tool_use" ||
        block.type === "tool_result")
  );
}

export function isVisibleHumanQuestion(message: Message) {
  return (
    message.sender === "human" &&
    (isRenderableBlock(message) ||
      Boolean(message.files?.length) ||
      Boolean(
        message.attachments?.some((attachment) => attachment.extracted_content)
      ))
  );
}

export function visibleMessages(
  conversation?: Conversation,
  hiddenQuestionIds: ReadonlySet<string> = new Set()
): Message[] {
  if (!conversation) return [];
  let hideCurrentTurn = false;
  return currentBranch(conversation.chat_messages || []).filter((message) => {
    if (isVisibleHumanQuestion(message)) {
      hideCurrentTurn = hiddenQuestionIds.has(message.uuid);
    }
    return !hideCurrentTurn;
  });
}

export function questionTurnMessageIds(
  conversation: Conversation,
  questionUuid: string
) {
  const messageIds = new Set<string>();
  let insideQuestionTurn = false;
  for (const message of currentBranch(conversation.chat_messages || [])) {
    if (isVisibleHumanQuestion(message)) {
      if (insideQuestionTurn && message.uuid !== questionUuid) break;
      insideQuestionTurn = message.uuid === questionUuid;
    }
    if (insideQuestionTurn) messageIds.add(message.uuid);
  }
  return messageIds;
}

interface AnswerHeadingCandidate extends HeadingEntry {
  source: ParsedHeading["source"];
  sourceLevel: number;
}

function headingCandidatesFromText(
  text: string,
  prefix: string
): AnswerHeadingCandidate[] {
  return parseHeadingCandidates(text).map((heading, index) => ({
    id: `${prefix}-${index}`,
    level: heading.level,
    text: heading.text,
    fullText: heading.text,
    kind: "answer" as const,
    source: heading.source,
    sourceLevel: heading.level
  }));
}

function primaryAnswerHeadings(
  candidates: AnswerHeadingCandidate[],
  questionNumber: number
): HeadingEntry[] {
  const formal = candidates.filter(
    (heading) => heading.source === "formal"
  );
  let selected: AnswerHeadingCandidate[] = [];
  if (formal.length) {
    selected = formal.filter((heading) => heading.sourceLevel <= 2);
  } else {
    const structured = candidates.filter(
      (heading) => heading.source === "structured"
    );
    const bold = candidates.filter((heading) => heading.source === "bold");
    selected = structured.length
      ? structured
      : bold.length >= 2
        ? bold
        : [];
  }

  return selected.map(
    ({ source: _source, sourceLevel: _sourceLevel, ...heading }) => ({
      ...heading,
      questionNumber: questionNumber || undefined
    })
  );
}

function visibleMessageText(message: Message) {
  const blocks = message.content || [];
  const visibleBlocks = blocks
    .filter(
      (block) =>
        block.type === "text" &&
        !block.hidden &&
        !block.hidden_in_chat &&
        block.text
    )
    .map((block) => block.text || "");
  return blocks.length ? visibleBlocks.join("\n\n") : message.text || "";
}

function plainQuestionText(text: string) {
  return text
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, " 代码片段 ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^ {0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^ {0,3}(?:[-*+]|\d+[.)、])[ \t]+/gm, "")
    .replace(/[*_~`>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numberedQuestionItems(text: string) {
  const items: string[] = [];
  let current = "";
  for (const line of text.split(/\r?\n/)) {
    const start = /^\s*\d+[.)、][ \t]+(.+)$/.exec(line);
    if (start) {
      if (current) items.push(current);
      current = start[1].trim();
    } else if (current && line.trim()) {
      current = `${current} ${line.trim()}`;
    }
  }
  if (current) items.push(current);
  return items;
}

function countQuestions(text: string, numberedCount: number) {
  const punctuation = text.match(/[?？]/g)?.length || 0;
  return numberedCount > 1 ? numberedCount : punctuation;
}

function shortenQuestion(text: string, questionCount: number) {
  const characters = Array.from(text);
  const countLabel = questionCount > 1 ? ` · 共 ${questionCount} 问` : "";
  if (characters.length <= QUESTION_MAX_LENGTH) {
    return `${text}${countLabel}`;
  }

  const strongStops = new Set(["？", "?", "！", "!", "。"]);
  for (
    let index = QUESTION_MIN_LENGTH - 1;
    index < QUESTION_MAX_LENGTH;
    index += 1
  ) {
    if (strongStops.has(characters[index])) {
      return `${characters.slice(0, index + 1).join("")}…${countLabel}`;
    }
  }

  const softStops = new Set(["，", ",", "；", ";", "：", ":", " "]);
  for (
    let index = QUESTION_MAX_LENGTH - 1;
    index >= QUESTION_MIN_LENGTH;
    index -= 1
  ) {
    if (softStops.has(characters[index])) {
      return `${characters.slice(0, index).join("").trim()}…${countLabel}`;
    }
  }

  return `${characters
    .slice(0, QUESTION_MAX_LENGTH)
    .join("")
    .trim()}…${countLabel}`;
}

export function extractHeadings(messages: Message[]): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  let questionNumber = 0;
  let currentQuestionNumber = 0;
  for (const message of messages) {
    if (message.sender === "human") {
      const rawText = visibleMessageText(message);
      const fullText = plainQuestionText(rawText);
      const numberedItems = numberedQuestionItems(rawText);
      const summaryText =
        numberedItems.length > 1
          ? plainQuestionText(numberedItems[0])
          : fullText;
      const questionCount = countQuestions(rawText, numberedItems.length);
      const attachmentLabel =
        message.files?.[0]?.file_name ||
        message.attachments?.find((attachment) => attachment.extracted_content)
          ?.file_name;
      if (!fullText && !attachmentLabel) {
        currentQuestionNumber = 0;
        continue;
      }
      questionNumber += 1;
      currentQuestionNumber = questionNumber;
      headings.push({
        id: `message-${message.uuid}`,
        messageUuid: message.uuid,
        level: 1,
        text: fullText
          ? shortenQuestion(summaryText, questionCount)
          : shortenQuestion(attachmentLabel || "附件消息", 0),
        fullText: fullText || attachmentLabel || "附件消息",
        kind: "question",
        questionNumber
      });
      continue;
    }

    const blocks = message.content || [];
    const candidates: AnswerHeadingCandidate[] = [];
    blocks.forEach((block, blockIndex) => {
      if (
        block.type !== "text" ||
        block.hidden ||
        block.hidden_in_chat ||
        !block.text
      ) {
        return;
      }
      candidates.push(
        ...headingCandidatesFromText(
          block.text,
          `heading-${message.uuid}-${blockIndex}`
        )
      );
    });
    if (blocks.length === 0 && message.text) {
      candidates.push(
        ...headingCandidatesFromText(
          message.text,
          `heading-${message.uuid}-fallback`
        )
      );
    }
    headings.push(
      ...primaryAnswerHeadings(candidates, currentQuestionNumber)
    );
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
