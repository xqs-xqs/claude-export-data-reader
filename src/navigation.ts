import type { MemoryScope } from "./memory";

export type ReaderLocation =
  | {
      kind: "account";
      accountUuid: string;
    }
  | {
      kind: "conversation";
      accountUuid: string;
      conversationKey: string;
    }
  | {
      kind: "memory";
      accountUuid: string;
      scope: MemoryScope;
      projectUuid?: string;
      filePath?: string;
    };

export interface NavigationHighlight {
  messageId: string;
  query: string;
}

export interface NavigationEntry {
  id: number;
  location: ReaderLocation;
  mainScrollTop: number;
  activeHeading?: string;
  highlight?: NavigationHighlight;
}

export interface NavigationHistory {
  entries: NavigationEntry[];
  index: number;
  nextId: number;
}

const MAX_HISTORY_ENTRIES = 100;

export function locationContextKey(location: ReaderLocation) {
  if (location.kind === "account") {
    return `account:${location.accountUuid}:empty`;
  }
  if (location.kind === "conversation") {
    return `conversation:${location.conversationKey}`;
  }
  return `memory:${location.accountUuid}:${location.scope}:${
    location.projectUuid || "account"
  }:${location.filePath || "index"}`;
}

function sameLocation(left: ReaderLocation, right: ReaderLocation) {
  return (
    left.kind === right.kind &&
    left.accountUuid === right.accountUuid &&
    (left.kind === "account" && right.kind === "account"
      ? true
      : left.kind === "conversation" && right.kind === "conversation"
        ? left.conversationKey === right.conversationKey
        : left.kind === "memory" && right.kind === "memory"
          ? left.scope === right.scope &&
            left.projectUuid === right.projectUuid &&
            left.filePath === right.filePath
          : false)
  );
}

function sameHighlight(
  left: NavigationHighlight | undefined,
  right: NavigationHighlight | undefined
) {
  return (
    left?.messageId === right?.messageId && left?.query === right?.query
  );
}

export function seedNavigationHistory(
  location: ReaderLocation,
  mainScrollTop: number,
  activeHeading?: string
): NavigationHistory {
  return {
    entries: [
      {
        id: 1,
        location,
        mainScrollTop,
        activeHeading
      }
    ],
    index: 0,
    nextId: 2
  };
}

export function updateCurrentNavigationEntry(
  history: NavigationHistory,
  patch: Pick<NavigationEntry, "mainScrollTop" | "activeHeading">
): NavigationHistory {
  const current = history.entries[history.index];
  if (!current) return history;
  const entries = [...history.entries];
  entries[history.index] = { ...current, ...patch };
  return { ...history, entries };
}

export function pushNavigationEntry(
  history: NavigationHistory,
  location: ReaderLocation,
  options: {
    activeHeading?: string;
    highlight?: NavigationHighlight;
    mainScrollTop?: number;
  } = {}
): NavigationHistory {
  const current = history.entries[history.index];
  if (
    current &&
    sameLocation(current.location, location) &&
    sameHighlight(current.highlight, options.highlight)
  ) {
    return history;
  }

  const entry: NavigationEntry = {
    id: history.nextId,
    location,
    mainScrollTop: options.mainScrollTop || 0,
    activeHeading: options.activeHeading,
    highlight: options.highlight
  };
  const entries = [...history.entries.slice(0, history.index + 1), entry].slice(
    -MAX_HISTORY_ENTRIES
  );
  return {
    entries,
    index: entries.length - 1,
    nextId: history.nextId + 1
  };
}

export function replaceCurrentNavigationEntry(
  history: NavigationHistory,
  location: ReaderLocation,
  options: {
    activeHeading?: string;
    highlight?: NavigationHighlight;
    mainScrollTop?: number;
  } = {}
): NavigationHistory {
  const current = history.entries[history.index];
  if (!current) {
    return seedNavigationHistory(
      location,
      options.mainScrollTop || 0,
      options.activeHeading
    );
  }
  const entries = [...history.entries];
  entries[history.index] = {
    id: current.id,
    location,
    mainScrollTop: options.mainScrollTop || 0,
    activeHeading: options.activeHeading,
    highlight: options.highlight
  };
  return { ...history, entries };
}

export function historyEntryInDirection(
  history: NavigationHistory,
  direction: -1 | 1,
  isValid: (entry: NavigationEntry) => boolean
) {
  let index = history.index + direction;
  while (index >= 0 && index < history.entries.length) {
    const entry = history.entries[index];
    if (isValid(entry)) {
      return {
        entry,
        history: { ...history, index }
      };
    }
    index += direction;
  }
  return undefined;
}

export function canNavigateHistory(
  history: NavigationHistory | undefined,
  direction: -1 | 1,
  isValid: (entry: NavigationEntry) => boolean
) {
  return Boolean(
    history && historyEntryInDirection(history, direction, isValid)
  );
}

export function filterNavigationHistory(
  history: NavigationHistory,
  isValid: (entry: NavigationEntry) => boolean
) {
  const current = history.entries[history.index];
  const surviving = history.entries
    .map((entry, originalIndex) => ({ entry, originalIndex }))
    .filter(({ entry }) => isValid(entry));
  if (!surviving.length) return undefined;
  const entries = surviving.map(({ entry }) => entry);
  const currentIndex = current
    ? entries.findIndex((entry) => entry.id === current.id)
    : -1;
  let nearestPrevious = -1;
  surviving.forEach(({ originalIndex }, index) => {
    if (originalIndex < history.index) nearestPrevious = index;
  });
  return {
    ...history,
    entries,
    index:
      currentIndex >= 0
        ? currentIndex
        : nearestPrevious >= 0
          ? nearestPrevious
          : 0
  };
}
