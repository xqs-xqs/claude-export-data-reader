import type { HiddenItemsState } from "./types";

export type { HiddenItemsState } from "./types";

const STORAGE_KEY = "reader-hidden-items-v1";
const MAX_CONVERSATIONS = 100_000;
const MAX_QUESTIONS_PER_CONVERSATION = 2_000_000;

const EMPTY_HIDDEN_ITEMS: HiddenItemsState = {
  version: 1,
  conversationKeys: [],
  questionIdsByConversation: {}
};

function persistedId(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 8192
    ? value
    : undefined;
}

function uniqueIds(value: unknown, maximum: number) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map(persistedId).filter((id): id is string => Boolean(id)))
  ).slice(-maximum);
}

export function readHiddenItems(): HiddenItemsState {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "null"
    ) as Record<string, unknown> | null;
    if (!parsed || parsed.version !== 1) return EMPTY_HIDDEN_ITEMS;

    const rawQuestions =
      parsed.questionIdsByConversation &&
      typeof parsed.questionIdsByConversation === "object" &&
      !Array.isArray(parsed.questionIdsByConversation)
        ? Object.entries(parsed.questionIdsByConversation)
        : [];
    const questionIdsByConversation = Object.fromEntries(
      rawQuestions
        .map(([conversationKey, questionIds]) => [
          persistedId(conversationKey),
          uniqueIds(questionIds, MAX_QUESTIONS_PER_CONVERSATION)
        ] as const)
        .filter(
          (entry): entry is readonly [string, string[]] =>
            Boolean(entry[0]) && entry[1].length > 0
        )
        .slice(-MAX_CONVERSATIONS)
    );

    return {
      version: 1,
      conversationKeys: uniqueIds(
        parsed.conversationKeys,
        MAX_CONVERSATIONS
      ),
      questionIdsByConversation
    };
  } catch {
    return EMPTY_HIDDEN_ITEMS;
  }
}

export function persistHiddenItems(state: HiddenItemsState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    // The imported archive remains readable if browser preferences cannot save.
    return false;
  }
}

export function hiddenConversationKey(
  accountUuid: string,
  conversationUuid: string
) {
  return JSON.stringify([accountUuid, conversationUuid]);
}

export function hideConversation(
  state: HiddenItemsState,
  accountUuid: string,
  conversationUuid: string
): HiddenItemsState {
  const conversationKey = hiddenConversationKey(accountUuid, conversationUuid);
  if (state.conversationKeys.includes(conversationKey)) return state;
  return {
    ...state,
    conversationKeys: [...state.conversationKeys, conversationKey].slice(
      -MAX_CONVERSATIONS
    )
  };
}

export function hideQuestion(
  state: HiddenItemsState,
  accountUuid: string,
  conversationUuid: string,
  questionId: string
): HiddenItemsState {
  const conversationKey = hiddenConversationKey(accountUuid, conversationUuid);
  const current = state.questionIdsByConversation[conversationKey] || [];
  if (current.includes(questionId)) return state;
  return {
    ...state,
    questionIdsByConversation: {
      ...state.questionIdsByConversation,
      [conversationKey]: [...current, questionId].slice(
        -MAX_QUESTIONS_PER_CONVERSATION
      )
    }
  };
}
