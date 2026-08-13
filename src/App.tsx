import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import type { Account, Conversation, HeadingEntry, Library } from "./types";
import { dateLabel, extractHeadings, visibleMessages } from "./conversation";
import MessageView from "./MessageView";
import MemoryPage, {
  MemoryOutline,
  StructuredMemoryOutline
} from "./MemoryView";
import {
  prepareMemoryDocument,
  prepareStructuredMemoryFiles,
  type MemoryProjectOption,
  type MemoryScope
} from "./memory";
import { DEMO_LIBRARY } from "./demo";
import {
  buildConversationSearchIndex,
  conversationDisplayTitle,
  findSearchMatchRanges,
  normalizeSearchText,
  searchConversationIndex
} from "./search";
import {
  ChevronIcon,
  CloseIcon,
  ImportIcon,
  MemoryIcon,
  MenuIcon,
  MoonIcon,
  OutlineIcon,
  SearchIcon,
  StarIcon,
  SunIcon
} from "./icons";

const EMPTY_LIBRARY: Library = {
  version: 1,
  imports: [],
  accounts: [],
  conversations: [],
  projects: [],
  memories: [],
  pinned_conversations: []
};

type Theme = "light" | "dark";
type PanelSide = "sidebar" | "outline";
type PrimaryView = "conversation" | "memory";

interface FontSettings {
  chat: number;
  sidebar: number;
  outline: number;
}

interface PanelWidths {
  sidebar: number;
  outline: number;
}

interface ActiveResize {
  side: PanelSide;
  pointerId: number;
  startX: number;
  startWidth: number;
}

interface SearchTarget {
  conversationKey: string;
  messageId: string;
  query: string;
  sequence: number;
}

const DEFAULT_FONT_SETTINGS: FontSettings = {
  chat: 16,
  sidebar: 13,
  outline: 13
};

const DEFAULT_PANEL_WIDTHS: PanelWidths = {
  sidebar: 282,
  outline: 248
};

const PANEL_LIMITS = {
  sidebar: { minimum: 220, maximum: 420 },
  outline: { minimum: 220, maximum: 400 }
} as const;

const RESIZER_WIDTH = 7;

function clamp(value: unknown, minimum: number, maximum: number, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(maximum, Math.max(minimum, numeric))
    : fallback;
}

function conversationKey(conversation: Conversation) {
  return `${conversation.account_uuid}:${conversation.uuid}`;
}

function accountDisplayName(account: Account | undefined) {
  return account?.full_name || account?.email_address || "未命名账户";
}

function HighlightedSearchText({
  text,
  query
}: {
  text: string;
  query: string;
}) {
  const ranges = findSearchMatchRanges(text, query);
  if (!ranges.length) return text;

  const parts: Array<{ highlighted: boolean; text: string }> = [];
  let cursor = 0;

  for (const range of ranges) {
    if (range.start > cursor) {
      parts.push({
        highlighted: false,
        text: text.slice(cursor, range.start)
      });
    }
    parts.push({
      highlighted: true,
      text: text.slice(range.start, range.end)
    });
    cursor = range.end;
  }

  if (cursor < text.length) {
    parts.push({ highlighted: false, text: text.slice(cursor) });
  }

  return parts.map((part, index) =>
    part.highlighted ? (
      <mark className="search-result-highlight" key={index}>
        {part.text}
      </mark>
    ) : (
      part.text
    )
  );
}

function initialPanelWidths(): PanelWidths {
  try {
    const saved = JSON.parse(localStorage.getItem("panel-widths-v1") || "");
    return {
      sidebar: clamp(
        saved.sidebar,
        PANEL_LIMITS.sidebar.minimum,
        PANEL_LIMITS.sidebar.maximum,
        DEFAULT_PANEL_WIDTHS.sidebar
      ),
      outline: clamp(
        saved.outline,
        PANEL_LIMITS.outline.minimum,
        PANEL_LIMITS.outline.maximum,
        DEFAULT_PANEL_WIDTHS.outline
      )
    };
  } catch {
    return DEFAULT_PANEL_WIDTHS;
  }
}

function mainMinimumWidth(viewportWidth: number) {
  return viewportWidth <= 1180 ? 480 : 560;
}

function fitPanelWidths(
  desired: PanelWidths,
  sidebarOpen: boolean,
  outlineOpen: boolean,
  viewportWidth: number
): PanelWidths {
  let sidebar = clamp(
    desired.sidebar,
    PANEL_LIMITS.sidebar.minimum,
    PANEL_LIMITS.sidebar.maximum,
    DEFAULT_PANEL_WIDTHS.sidebar
  );
  let outline = clamp(
    desired.outline,
    PANEL_LIMITS.outline.minimum,
    PANEL_LIMITS.outline.maximum,
    DEFAULT_PANEL_WIDTHS.outline
  );
  const openCount = Number(sidebarOpen) + Number(outlineOpen);
  const available =
    viewportWidth -
    mainMinimumWidth(viewportWidth) -
    openCount * RESIZER_WIDTH;

  if (sidebarOpen && outlineOpen && sidebar + outline > available) {
    const sidebarFlex = sidebar - PANEL_LIMITS.sidebar.minimum;
    const outlineFlex = outline - PANEL_LIMITS.outline.minimum;
    const totalFlex = sidebarFlex + outlineFlex;
    const excess = sidebar + outline - available;
    const sidebarReduction =
      totalFlex > 0 ? Math.min(sidebarFlex, excess * (sidebarFlex / totalFlex)) : 0;
    sidebar -= sidebarReduction;
    outline -= Math.min(outlineFlex, excess - sidebarReduction);
  } else if (sidebarOpen && !outlineOpen) {
    sidebar = Math.min(sidebar, available);
  } else if (!sidebarOpen && outlineOpen) {
    outline = Math.min(outline, available);
  }

  return {
    sidebar: Math.round(
      Math.max(PANEL_LIMITS.sidebar.minimum, sidebar)
    ),
    outline: Math.round(
      Math.max(PANEL_LIMITS.outline.minimum, outline)
    )
  };
}

function initialFontSettings(): FontSettings {
  try {
    const saved = JSON.parse(localStorage.getItem("font-settings") || "");
    return {
      chat: clamp(saved.chat, 14, 22, DEFAULT_FONT_SETTINGS.chat),
      sidebar: clamp(saved.sidebar, 11, 18, DEFAULT_FONT_SETTINGS.sidebar),
      outline: clamp(saved.outline, 11, 18, DEFAULT_FONT_SETTINGS.outline)
    };
  } catch {
    return DEFAULT_FONT_SETTINGS;
  }
}

function Sidebar({
  library,
  activeAccountUuid,
  pinnedConversations,
  recentConversations,
  pinnedKeys,
  pinningKeys,
  selectedKey,
  memoryActive,
  onSelect,
  onTogglePinned,
  onOpenMemory,
  onOpenSearch,
  onSelectAccount,
  onImport,
  importing
}: {
  library: Library;
  activeAccountUuid?: string;
  pinnedConversations: Conversation[];
  recentConversations: Conversation[];
  pinnedKeys: Set<string>;
  pinningKeys: Set<string>;
  selectedKey?: string;
  memoryActive: boolean;
  onSelect: (conversation: Conversation) => void;
  onTogglePinned: (conversation: Conversation) => void;
  onOpenMemory: () => void;
  onOpenSearch: () => void;
  onSelectAccount: (accountUuid: string) => void;
  onImport: () => void;
  importing: boolean;
}) {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountSwitcherRef = useRef<HTMLDivElement>(null);
  const activeAccount = library.accounts.find(
    (account) => account.uuid === activeAccountUuid
  );
  const activeAccountName = accountDisplayName(activeAccount);

  useEffect(() => {
    if (!accountMenuOpen) return;

    function closeAccountMenu(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setAccountMenuOpen(false);
        return;
      }
      const target = event.target;
      if (
        target instanceof Node &&
        !accountSwitcherRef.current?.contains(target)
      ) {
        setAccountMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", closeAccountMenu);
    window.addEventListener("keydown", closeAccountMenu);
    return () => {
      window.removeEventListener("pointerdown", closeAccountMenu);
      window.removeEventListener("keydown", closeAccountMenu);
    };
  }, [accountMenuOpen]);

  const renderConversation = (conversation: Conversation) => {
    const key = conversationKey(conversation);
    const pinned = pinnedKeys.has(key);
    return (
      <div
        className={`conversation-row ${selectedKey === key ? "is-active" : ""}`}
        key={key}
      >
        <button
          type="button"
          className="conversation-select"
          onClick={() => onSelect(conversation)}
        >
          <span className="conversation-title">
            {conversationDisplayTitle(conversation)}
          </span>
          <span className="conversation-date">
            {dateLabel(conversation.updated_at || conversation.created_at)}
          </span>
        </button>
        <button
          type="button"
          className={`conversation-pin ${pinned ? "is-pinned" : ""}`}
          onClick={() => onTogglePinned(conversation)}
          disabled={pinningKeys.has(key)}
          aria-label={pinned ? "取消收藏此对话" : "收藏并置顶此对话"}
          aria-pressed={pinned}
          title={pinned ? "取消收藏" : "收藏并置顶"}
        >
          <StarIcon />
        </button>
      </div>
    );
  };

  return (
    <aside className="sidebar" id="conversation-sidebar">
      <div className="brand">
        <div className="brand-mark">C</div>
        <div>
          <strong>Claude 导出数据阅读器</strong>
          <span>本地只读归档</span>
        </div>
      </div>

      <button className="primary-action" onClick={onImport} disabled={importing}>
        <ImportIcon />
        {importing ? "正在导入…" : "导入数据"}
      </button>

      <button
        className="search search-launch"
        onClick={onOpenSearch}
        aria-label="搜索当前账户对话"
        title="搜索当前账户对话（Ctrl + Shift + F）"
      >
        <SearchIcon />
        <span>搜索当前账户对话</span>
        <kbd>Ctrl ⇧ F</kbd>
      </button>

      <button
        type="button"
        className={`library-view-button ${memoryActive ? "is-active" : ""}`}
        onClick={onOpenMemory}
        aria-current={memoryActive ? "page" : undefined}
      >
        <MemoryIcon />
        <span>Memory</span>
      </button>

      <div className="conversation-lists">
        {pinnedConversations.length > 0 && (
          <section className="conversation-section">
            <div className="sidebar-section-title">
              <span>Pinned</span>
              <span>{pinnedConversations.length}</span>
            </div>
            <nav className="conversation-list" aria-label="Pinned">
              {pinnedConversations.map(renderConversation)}
            </nav>
          </section>
        )}

        <section className="conversation-section">
          <div className="sidebar-section-title">
            <span>最近聊天</span>
            <span>{recentConversations.length}</span>
          </div>
          <nav className="conversation-list" aria-label="最近聊天">
            {recentConversations.map(renderConversation)}
          </nav>
        </section>
      </div>

      <div className="account-switcher" ref={accountSwitcherRef}>
        {accountMenuOpen && library.accounts.length > 1 && (
          <div className="account-menu" role="menu" aria-label="切换账户">
            <div className="account-menu-title">切换账户</div>
            {library.accounts.map((account) => {
              const selected = account.uuid === activeAccountUuid;
              return (
                <button
                  type="button"
                  className={`account-menu-item ${selected ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={selected}
                  key={account.uuid}
                  onClick={() => {
                    onSelectAccount(account.uuid);
                    setAccountMenuOpen(false);
                  }}
                >
                  <span className="avatar account-menu-avatar">
                    {accountDisplayName(account).slice(0, 1)}
                  </span>
                  <span className="account-menu-copy">
                    <strong>{accountDisplayName(account)}</strong>
                    <small>{account.email_address || "未提供邮箱"}</small>
                  </span>
                  <span className="account-menu-check" aria-hidden="true">
                    {selected ? "✓" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <button
          type="button"
          className={`account-card ${accountMenuOpen ? "is-open" : ""}`}
          onClick={() =>
            library.accounts.length > 1 &&
            setAccountMenuOpen((value) => !value)
          }
          disabled={library.accounts.length < 2}
          aria-haspopup="menu"
          aria-expanded={accountMenuOpen}
          title={library.accounts.length > 1 ? "切换账户" : undefined}
        >
          <span className="avatar">
            {(activeAccount ? activeAccountName : "本").slice(0, 1)}
          </span>
          <span className="account-card-copy">
            <strong>{activeAccount ? activeAccountName : "本地阅读器"}</strong>
            <span>
              {library.accounts.length
                ? `${library.accounts.length} 个账户 · ${library.imports.length} 次导入`
                : "尚未导入数据"}
            </span>
          </span>
          {library.accounts.length > 1 && (
            <ChevronIcon className="account-card-chevron" />
          )}
        </button>
      </div>
    </aside>
  );
}

function GlobalSearchDialog({
  open,
  query,
  results,
  accountName,
  onQueryChange,
  onSelectConversation,
  onSelectMessage,
  onRequestClose
}: {
  open: boolean;
  query: string;
  results: ReturnType<typeof searchConversationIndex>;
  accountName?: string;
  onQueryChange: (query: string) => void;
  onSelectConversation: (conversation: Conversation) => void;
  onSelectMessage: (
    conversation: Conversation,
    messageId: string,
    query: string
  ) => void;
  onRequestClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const skipFocusRestoreRef = useRef(false);
  const backdropPointerDownRef = useRef(false);
  const searching = Boolean(normalizeSearchText(query));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        skipFocusRestoreRef.current = false;
        returnFocusRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        dialog.showModal();
      }
      const frame = window.requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(frame);
    }

    const shouldRestoreFocus = !skipFocusRestoreRef.current;
    skipFocusRestoreRef.current = false;
    if (dialog.open) dialog.close();
    const frame = window.requestAnimationFrame(() => {
      if (
        shouldRestoreFocus &&
        !document.querySelector(".conversation-findbar input") &&
        returnFocusRef.current?.isConnected
      ) {
        returnFocusRef.current.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(
    () => () => {
      if (dialogRef.current?.open) dialogRef.current.close();
    },
    []
  );

  return (
    <dialog
      className="global-search-dialog"
      ref={dialogRef}
      aria-labelledby="global-search-title"
      aria-describedby="global-search-description"
      onCancel={(event) => {
        event.preventDefault();
        onRequestClose();
      }}
      onClose={() => {
        if (open) onRequestClose();
      }}
      onPointerDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        backdropPointerDownRef.current =
          event.target === event.currentTarget &&
          (event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom);
      }}
      onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const outside =
          event.target === event.currentTarget &&
          (event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom);
        if (outside && backdropPointerDownRef.current) onRequestClose();
        backdropPointerDownRef.current = false;
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const resultElements = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            "[data-global-search-result]"
          ) || []
        );
        if (!resultElements.length) return;

        const currentIndex = resultElements.findIndex(
          (element) => element === document.activeElement
        );
        if (event.target === inputRef.current || currentIndex >= 0) {
          event.preventDefault();
          const direction = event.key === "ArrowDown" ? 1 : -1;
          const nextIndex =
            currentIndex < 0
              ? direction > 0
                ? 0
                : resultElements.length - 1
              : (currentIndex + direction + resultElements.length) %
                resultElements.length;
          resultElements[nextIndex].focus();
        }
      }}
    >
      <header className="global-search-header">
        <div>
          <h2 id="global-search-title">搜索当前账户</h2>
          <p id="global-search-description">
            在{accountName ? `“${accountName}”` : "当前账户"}中搜索会话标题、你的提问和 Claude 的回答
          </p>
        </div>
        <button
          className="icon-button"
          onClick={onRequestClose}
          aria-label="关闭全局搜索"
          title="关闭（Esc）"
        >
          <CloseIcon />
        </button>
      </header>

      <label className="global-search-input">
        <SearchIcon />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="输入关键词"
          aria-label="搜索当前账户对话"
        />
        {searching && (
          <span className="global-search-count" role="status" aria-live="polite">
            {results.totalMatches} 条结果
          </span>
        )}
      </label>

      <div
        className="global-search-results"
        role="region"
        aria-label="当前账户搜索结果"
      >
        {!searching ? (
          <div className="global-search-placeholder">
            <SearchIcon />
            <strong>从当前账户归档中查找</strong>
            <span>输入标题或消息正文中的关键词。</span>
          </div>
        ) : results.groups.length ? (
          results.groups.map((group) => (
            <section
              className="global-search-group"
              key={group.key}
              aria-label={`${conversationDisplayTitle(
                group.conversation
              )}的搜索结果`}
            >
              <button
                className="global-search-conversation"
                onClick={() => {
                  skipFocusRestoreRef.current = true;
                  onSelectConversation(group.conversation);
                }}
                title={conversationDisplayTitle(group.conversation)}
                data-global-search-result
              >
                <span className="global-search-conversation-title">
                  <HighlightedSearchText
                    text={conversationDisplayTitle(group.conversation)}
                    query={query}
                  />
                </span>
                <span className="global-search-conversation-meta">
                  {group.titleMatch && (
                    <span className="search-result-kind">标题</span>
                  )}
                  <span>
                    {dateLabel(
                      group.conversation.updated_at ||
                        group.conversation.created_at
                    )}
                  </span>
                </span>
              </button>

              {group.messageMatches.map(({ message, snippet }) => (
                <button
                  className="global-search-message"
                  key={message.uuid}
                  onClick={() => {
                    skipFocusRestoreRef.current = true;
                    onSelectMessage(
                      group.conversation,
                      message.uuid,
                      query
                    );
                  }}
                  title={snippet}
                  data-global-search-result
                >
                  <span className="global-search-sender">
                    {message.sender === "human" ? "你" : "Claude"}
                  </span>
                  <span className="global-search-snippet">
                    <HighlightedSearchText text={snippet} query={query} />
                  </span>
                  <span className="global-search-date">
                    {dateLabel(message.created_at)}
                  </span>
                </button>
              ))}
            </section>
          ))
        ) : (
          <div className="search-empty">
            没有找到匹配的对话标题或消息。
          </div>
        )}

        {searching && results.truncated && (
          <div className="search-limit-note">
            共 {results.totalMatches} 条结果，当前显示{" "}
            {results.shownMatches} 条。
          </div>
        )}
      </div>

      <footer className="global-search-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> 浏览结果
        </span>
        <span>
          <kbd>Esc</kbd> 关闭
        </span>
      </footer>
    </dialog>
  );
}

function ConversationFindBar({
  query,
  activeIndex,
  matchCount,
  pending,
  focusSequence,
  onQueryChange,
  onPrevious,
  onNext,
  onClose
}: {
  query: string;
  activeIndex: number;
  matchCount: number;
  pending: boolean;
  focusSequence: number;
  onQueryChange: (query: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSequence]);

  return (
    <div className="conversation-findbar" role="search">
      <SearchIcon />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.key !== "Enter") return;
          event.preventDefault();
          if (event.shiftKey) onPrevious();
          else onNext();
        }}
        placeholder="在当前对话中查找"
        aria-label="在当前对话中查找"
      />
      <span className="conversation-find-count" role="status" aria-live="polite">
        {pending
          ? "…"
          : matchCount
            ? `${activeIndex + 1} / ${matchCount}`
            : "0 / 0"}
      </span>
      <button
        className="find-control find-previous"
        onClick={onPrevious}
        disabled={!matchCount}
        aria-label="上一个匹配项"
        title="上一个匹配项（Shift + Enter）"
      >
        <ChevronIcon />
      </button>
      <button
        className="find-control find-next"
        onClick={onNext}
        disabled={!matchCount}
        aria-label="下一个匹配项"
        title="下一个匹配项（Enter）"
      >
        <ChevronIcon />
      </button>
      <button
        className="find-control"
        onClick={onClose}
        aria-label="关闭当前对话查找"
        title="关闭（Esc）"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function Outline({
  headings,
  activeId,
  onNavigate,
  onClose
}: {
  headings: HeadingEntry[];
  activeId?: string;
  onNavigate: (id: string) => void;
  onClose: () => void;
}) {
  const firstQuestion = headings.find((heading) => heading.kind === "question");
  const activeEntry = headings.find((heading) => heading.id === activeId);
  const activeQuestionNumber =
    activeEntry?.questionNumber || firstQuestion?.questionNumber;
  const visibleEntries = headings.filter(
    (heading) =>
      heading.kind === "question" ||
      !heading.questionNumber ||
      heading.questionNumber === activeQuestionNumber
  );
  const answerDepths = new Map<string, number>();
  const headingStack: number[] = [];
  visibleEntries.forEach((heading) => {
    if (heading.kind === "question") {
      headingStack.length = 0;
      return;
    }
    while (
      headingStack.length &&
      headingStack[headingStack.length - 1] >= heading.level
    ) {
      headingStack.pop();
    }
    answerDepths.set(heading.id, Math.min(headingStack.length, 2));
    headingStack.push(heading.level);
  });

  return (
    <aside className="outline" id="conversation-outline">
      <div className="outline-header">
        <div className="outline-title">对话导航</div>
        <button
          className="outline-close"
          onClick={onClose}
          aria-label="收起对话导航"
          title="收起对话导航"
        >
          <ChevronIcon />
        </button>
      </div>
      {headings.length ? (
        <nav aria-label="对话目录">
          {visibleEntries.map((heading) => (
            <button
              key={heading.id}
              className={`outline-entry outline-${heading.kind} ${
                activeId === heading.id ? "is-active" : ""
              } ${
                heading.kind === "question" &&
                heading.questionNumber === activeQuestionNumber
                  ? "is-group-open"
                  : ""
              } ${
                heading.kind === "answer"
                  ? `outline-depth-${answerDepths.get(heading.id) || 0}`
                  : ""
              }`}
              title={heading.fullText || heading.text}
              onClick={() => onNavigate(heading.id)}
              aria-expanded={
                heading.kind === "question"
                  ? heading.questionNumber === activeQuestionNumber
                  : undefined
              }
              aria-current={activeId === heading.id ? "location" : undefined}
            >
              {heading.kind === "question" && (
                <span className="outline-question-index">
                  {heading.questionNumber}
                </span>
              )}
              <span className="outline-entry-text">{heading.text}</span>
            </button>
          ))}
        </nav>
      ) : (
        <p>当前会话没有可导航的问题或主要标题。</p>
      )}
    </aside>
  );
}

function PanelResizer({
  side,
  value,
  minimum,
  maximum,
  active,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
  onKeyDown,
  onDoubleClick
}: {
  side: PanelSide;
  value: number;
  minimum: number;
  maximum: number;
  active: boolean;
  onPointerDown: (
    side: PanelSide,
    event: ReactPointerEvent<HTMLDivElement>
  ) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown: (
    side: PanelSide,
    event: ReactKeyboardEvent<HTMLDivElement>
  ) => void;
  onDoubleClick: (side: PanelSide) => void;
}) {
  const label = side === "sidebar" ? "左侧会话栏" : "右侧导航栏";
  return (
    <div
      className={`panel-resizer panel-resizer-${side} ${
        active ? "is-resizing" : ""
      }`}
      role="separator"
      tabIndex={0}
      aria-label={`调整${label}宽度`}
      aria-controls={
        side === "sidebar" ? "conversation-sidebar" : "conversation-outline"
      }
      aria-orientation="vertical"
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={value}
      aria-valuetext={`${value} 像素`}
      title={`拖动调整${label}宽度，双击恢复默认`}
      onPointerDown={(event) => onPointerDown(side, event)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onKeyDown={(event) => onKeyDown(side, event)}
      onDoubleClick={() => onDoubleClick(side)}
    />
  );
}

export default function App() {
  const [library, setLibrary] = useState<Library>(EMPTY_LIBRARY);
  const [selectedAccountUuid, setSelectedAccountUuid] = useState<string | undefined>(
    () => localStorage.getItem("selected-account-uuid") || undefined
  );
  const [selectedKey, setSelectedKey] = useState<string>();
  const [primaryView, setPrimaryView] =
    useState<PrimaryView>("conversation");
  const [memoryScope, setMemoryScope] = useState<MemoryScope>("account");
  const [selectedMemoryFilePath, setSelectedMemoryFilePath] =
    useState<string>();
  const [selectedProjectMemoryUuid, setSelectedProjectMemoryUuid] =
    useState<string>();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [outlineOpen, setOutlineOpen] = useState(
    () => localStorage.getItem("outline-open") !== "false"
  );
  const [panelWidths, setPanelWidths] = useState<PanelWidths>(
    initialPanelWidths
  );
  const panelWidthsRef = useRef(panelWidths);
  const activeResize = useRef<ActiveResize | undefined>(undefined);
  const [resizingSide, setResizingSide] = useState<PanelSide>();
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("theme") as Theme) || "light"
  );
  const [fontSettings, setFontSettings] = useState<FontSettings>(
    initialFontSettings
  );
  const [fontMenuOpen, setFontMenuOpen] = useState(false);
  const [activeHeading, setActiveHeading] = useState<string>();
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [searchTarget, setSearchTarget] = useState<SearchTarget>();
  const searchSequence = useRef(0);
  const [conversationFindOpen, setConversationFindOpen] = useState(false);
  const [conversationFindQuery, setConversationFindQuery] = useState("");
  const [conversationFindFocusSequence, setConversationFindFocusSequence] =
    useState(0);
  const conversationFindButtonRef = useRef<HTMLButtonElement>(null);
  const deferredConversationFindQuery = useDeferredValue(
    conversationFindQuery
  );
  const normalizedConversationFindQuery = normalizeSearchText(
    conversationFindQuery
  );
  const conversationFindHighlightQuery = conversationFindOpen
    ? normalizeSearchText(deferredConversationFindQuery)
    : "";
  const conversationFindPending =
    conversationFindOpen &&
    normalizedConversationFindQuery !== conversationFindHighlightQuery;
  const [conversationFindMatchIds, setConversationFindMatchIds] = useState<
    string[]
  >([]);
  const [conversationFindActiveIndex, setConversationFindActiveIndex] =
    useState(0);
  const [importing, setImporting] = useState(false);
  const [pinningKeys, setPinningKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [notice, setNotice] = useState<string>();
  const activeAccount = useMemo(
    () =>
      library.accounts.find(
        (account) => account.uuid === selectedAccountUuid
      ) || library.accounts[0],
    [library.accounts, selectedAccountUuid]
  );
  const activeAccountUuid = activeAccount?.uuid;
  const accountConversations = useMemo(
    () =>
      activeAccountUuid
        ? library.conversations.filter(
            (conversation) => conversation.account_uuid === activeAccountUuid
          )
        : [],
    [activeAccountUuid, library.conversations]
  );
  const memoryRecords = useMemo(() => {
    const latestByAccount = new Map<string, Library["memories"][number]>();
    for (const memory of library.memories || []) {
      const current = latestByAccount.get(memory.account_uuid);
      const currentTime = current?.imported_at
        ? new Date(current.imported_at).getTime()
        : 0;
      const nextTime = memory.imported_at
        ? new Date(memory.imported_at).getTime()
        : 0;
      if (!current || nextTime >= currentTime) {
        latestByAccount.set(memory.account_uuid, memory);
      }
    }
    return Array.from(latestByAccount.values());
  }, [library.memories]);
  const activeMemory =
    memoryRecords.find(
      (memory) => memory.account_uuid === activeAccountUuid
    );
  const activeMemoryAccountUuid = activeAccountUuid;
  const memoryProjectOptions = useMemo<MemoryProjectOption[]>(
    () =>
      Object.keys(activeMemory?.project_memories || {}).map((projectUuid) => {
        const project = library.projects.find(
          (item) =>
            item.account_uuid === activeMemory?.account_uuid &&
            item.uuid === projectUuid
        );
        return {
          uuid: projectUuid,
          name: project?.name || projectUuid
        };
      }),
    [activeMemory, library.projects]
  );
  const activeProjectMemoryUuid =
    memoryProjectOptions.find(
      (project) => project.uuid === selectedProjectMemoryUuid
    )?.uuid || memoryProjectOptions[0]?.uuid;
  const memoryText =
    memoryScope === "account"
      ? activeMemory?.conversations_memory
      : activeProjectMemoryUuid
        ? activeMemory?.project_memories[activeProjectMemoryUuid]
        : undefined;
  const structuredMemory = useMemo(
    () => prepareStructuredMemoryFiles(activeMemory?.memory_files),
    [activeMemory?.memory_files]
  );
  const structuredAccountMode = Boolean(
    memoryScope === "account" &&
      !activeMemory?.conversations_memory?.trim() &&
      structuredMemory.entries.length
  );
  const hasActiveAccountMemory = Boolean(
    activeMemory?.conversations_memory?.trim() ||
      activeMemory?.memory_files?.some((file) => file.content.trim())
  );
  const memoryAnchorPrefix = `memory-${
    activeMemoryAccountUuid || "none"
  }-${memoryScope}-${activeProjectMemoryUuid || "account"}`;
  const memoryDocument = useMemo(
    () => prepareMemoryDocument(memoryText, memoryAnchorPrefix),
    [memoryAnchorPrefix, memoryText]
  );
  const searchIndex = useMemo(
    () => buildConversationSearchIndex(accountConversations),
    [accountConversations]
  );
  const conversations = useMemo(
    () => searchIndex.map((entry) => entry.conversation),
    [searchIndex]
  );
  const pinnedAtByKey = useMemo(
    () =>
      new Map(
        (library.pinned_conversations || []).map((item) => [
          item.conversation_key,
          new Date(item.pinned_at).getTime()
        ])
      ),
    [library.pinned_conversations]
  );
  const pinnedKeys = useMemo(
    () => new Set(pinnedAtByKey.keys()),
    [pinnedAtByKey]
  );
  const pinnedConversations = useMemo(
    () =>
      conversations
        .filter((conversation) =>
          pinnedKeys.has(conversationKey(conversation))
        )
        .sort(
          (left, right) =>
            (pinnedAtByKey.get(conversationKey(right)) || 0) -
            (pinnedAtByKey.get(conversationKey(left)) || 0)
        ),
    [conversations, pinnedAtByKey, pinnedKeys]
  );
  const recentConversations = useMemo(
    () =>
      conversations.filter(
        (conversation) => !pinnedKeys.has(conversationKey(conversation))
      ),
    [conversations, pinnedKeys]
  );
  const globalSearchResults = useMemo(
    () => searchConversationIndex(searchIndex, globalSearchQuery),
    [globalSearchQuery, searchIndex]
  );
  const effectivePanelWidths = useMemo(
    () =>
      fitPanelWidths(
        panelWidths,
        sidebarOpen,
        outlineOpen,
        viewportWidth
      ),
    [outlineOpen, panelWidths, sidebarOpen, viewportWidth]
  );

  useEffect(() => {
    function trackViewportWidth() {
      setViewportWidth(window.innerWidth);
    }
    window.addEventListener("resize", trackViewportWidth);
    return () => window.removeEventListener("resize", trackViewportWidth);
  }, []);

  useEffect(
    () => () => document.documentElement.classList.remove("is-resizing"),
    []
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("outline-open", String(outlineOpen));
  }, [outlineOpen]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--chat-font-size", `${fontSettings.chat}px`);
    root.style.setProperty("--sidebar-font-size", `${fontSettings.sidebar}px`);
    root.style.setProperty("--outline-font-size", `${fontSettings.outline}px`);
    localStorage.setItem("font-settings", JSON.stringify(fontSettings));
  }, [fontSettings]);

  useEffect(() => {
    if (!library.accounts.length) return;

    setSelectedAccountUuid((current) => {
      const next = library.accounts.some((account) => account.uuid === current)
        ? current
        : library.accounts[0].uuid;
      if (next) localStorage.setItem("selected-account-uuid", next);
      return next;
    });
  }, [library.accounts]);

  useEffect(() => {
    if (!activeAccountUuid) {
      setSelectedKey(undefined);
      return;
    }

    setSelectedKey((current) => {
      const currentBelongsToAccount = accountConversations.some(
        (conversation) => conversationKey(conversation) === current
      );
      if (currentBelongsToAccount) return current;
      const first = accountConversations[0];
      return first ? conversationKey(first) : undefined;
    });
  }, [accountConversations, activeAccountUuid]);

  useEffect(() => {
    if (
      primaryView === "conversation" &&
      !accountConversations.length &&
      activeMemory
    ) {
      setPrimaryView("memory");
    }
  }, [accountConversations.length, activeMemory, primaryView]);

  useEffect(() => {
    const projectUuids = memoryProjectOptions.map((project) => project.uuid);
    setSelectedProjectMemoryUuid((current) =>
      current && projectUuids.includes(current)
        ? current
        : projectUuids[0]
    );
    setMemoryScope((current) => {
      if (current === "project" && !projectUuids.length) return "account";
      return current;
    });
  }, [activeMemory, memoryProjectOptions]);

  useEffect(() => {
    if (window.readerAPI) {
      window.readerAPI.getLibrary().then((nextLibrary) => {
        setLibrary(nextLibrary);
      });
    } else if (new URLSearchParams(window.location.search).has("demo")) {
      setLibrary(DEMO_LIBRARY);
    }
  }, []);

  useEffect(() => {
    function keyboardShortcut(event: KeyboardEvent) {
      const commandKey = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (event.key === "Escape") {
        setFontMenuOpen(false);
        if (conversationFindOpen) {
          event.preventDefault();
          closeConversationFind();
        }
      }
      if (
        commandKey &&
        !event.shiftKey &&
        key === "f" &&
        selectedKey &&
        primaryView === "conversation"
      ) {
        event.preventDefault();
        setGlobalSearchOpen(false);
        setSearchTarget(undefined);
        setConversationFindOpen(true);
        setConversationFindFocusSequence((value) => value + 1);
      }
      if (
        commandKey &&
        ((event.shiftKey && key === "f") ||
          (!event.shiftKey && key === "k"))
      ) {
        event.preventDefault();
        setConversationFindOpen(false);
        setGlobalSearchOpen(true);
        setFontMenuOpen(false);
      }
      if (commandKey && event.shiftKey && key === "o") {
        event.preventDefault();
        setOutlineOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", keyboardShortcut);
    return () => window.removeEventListener("keydown", keyboardShortcut);
  }, [conversationFindOpen, primaryView, selectedKey]);

  useEffect(() => {
    function closeFontMenu(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Element &&
        !target.closest(".font-settings-anchor")
      ) {
        setFontMenuOpen(false);
      }
    }
    window.addEventListener("pointerdown", closeFontMenu);
    return () => window.removeEventListener("pointerdown", closeFontMenu);
  }, []);

  const selectedConversation = useMemo(
    () =>
      library.conversations.find(
        (conversation) =>
          conversation.account_uuid === activeAccountUuid &&
          `${conversation.account_uuid}:${conversation.uuid}` === selectedKey
      ),
    [activeAccountUuid, library.conversations, selectedKey]
  );
  const messages = useMemo(
    () => visibleMessages(selectedConversation),
    [selectedConversation]
  );
  const selectedSearchEntry = useMemo(
    () => searchIndex.find((entry) => entry.key === selectedKey),
    [searchIndex, selectedKey]
  );
  const conversationFindMatchingMessageIds = useMemo(() => {
    if (!conversationFindHighlightQuery || !selectedSearchEntry) {
      return new Set<string>();
    }
    return new Set(
      selectedSearchEntry.messages
        .filter((entry) =>
          entry.normalizedText.includes(conversationFindHighlightQuery)
        )
        .map((entry) => entry.message.uuid)
    );
  }, [conversationFindHighlightQuery, selectedSearchEntry]);
  const conversationHeadings = useMemo(
    () => extractHeadings(messages),
    [messages]
  );
  const navigationHeadings =
    primaryView === "memory"
      ? structuredAccountMode
        ? []
        : memoryDocument.headings
      : conversationHeadings;

  useEffect(() => {
    if (!navigationHeadings.length) {
      setActiveHeading(undefined);
      return;
    }
    const scrollRoot =
      document.querySelector<HTMLElement>(".conversation-scroll");
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveHeading(visible[0].target.id);
      },
      {
        root: scrollRoot,
        rootMargin: "-12% 0px -75% 0px"
      }
    );
    navigationHeadings.forEach((heading) => {
      const element = document.getElementById(heading.id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [navigationHeadings, primaryView, selectedKey]);

  useEffect(() => {
    if (
      primaryView !== "conversation" ||
      !searchTarget ||
      searchTarget.conversationKey !== selectedKey
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const scroller =
        document.querySelector<HTMLElement>(".conversation-scroll");
      const message = document.getElementById(
        `message-${searchTarget.messageId}`
      );
      if (!scroller || !message || !scroller.contains(message)) return;

      const target =
        message.querySelector<HTMLElement>(".search-highlight") || message;
      message.tabIndex = -1;
      message.focus({ preventScroll: true });
      const targetTop =
        scroller.scrollTop +
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        76;
      scroller.scrollTo({
        top: Math.max(0, targetTop),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth"
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages, primaryView, searchTarget, selectedKey]);

  useEffect(() => {
    const scroller =
      document.querySelector<HTMLElement>(".conversation-scroll");
    if (!scroller) return;

    const clearCurrentMatch = () => {
      scroller
        .querySelectorAll<HTMLElement>(".search-highlight.is-current")
        .forEach((mark) => mark.classList.remove("is-current"));
    };

    if (
      !conversationFindOpen ||
      !conversationFindHighlightQuery ||
      conversationFindPending
    ) {
      clearCurrentMatch();
      setConversationFindMatchIds([]);
      setConversationFindActiveIndex(0);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const ids = Array.from(
        scroller.querySelectorAll<HTMLElement>(
          ".search-highlight[data-search-match-head='true']"
        )
      )
        .map((mark) => mark.dataset.searchMatchId)
        .filter((id): id is string => Boolean(id));
      setConversationFindMatchIds(ids);
      setConversationFindActiveIndex((current) =>
        ids.length ? Math.min(current, ids.length - 1) : 0
      );
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    conversationFindHighlightQuery,
    conversationFindOpen,
    conversationFindPending,
    messages,
    selectedKey
  ]);

  useEffect(() => {
    const scroller =
      document.querySelector<HTMLElement>(".conversation-scroll");
    if (!scroller) return;

    const marks = Array.from(
      scroller.querySelectorAll<HTMLElement>(
        ".search-highlight[data-search-match-id]"
      )
    );
    marks.forEach((mark) => mark.classList.remove("is-current"));

    if (
      !conversationFindOpen ||
      !conversationFindMatchIds.length ||
      conversationFindActiveIndex >= conversationFindMatchIds.length
    ) {
      return;
    }

    const activeId =
      conversationFindMatchIds[conversationFindActiveIndex];
    const activeMarks = marks.filter(
      (mark) => mark.dataset.searchMatchId === activeId
    );
    activeMarks.forEach((mark) => mark.classList.add("is-current"));
    const target =
      activeMarks.find(
        (mark) => mark.dataset.searchMatchHead === "true"
      ) || activeMarks[0];
    if (!target) return;

    const targetTop =
      scroller.scrollTop +
      target.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top -
      Math.min(180, scroller.clientHeight * 0.28);
    scroller.scrollTo({
      top: Math.max(0, targetTop),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth"
    });
  }, [
    conversationFindActiveIndex,
    conversationFindMatchIds,
    conversationFindOpen
  ]);

  async function importArchive() {
    if (!window.readerAPI) {
      setNotice("请在桌面应用中使用导入功能。");
      return;
    }
    setImporting(true);
    setNotice(undefined);
    try {
      const existingAccountUuids = new Set(
        library.accounts.map((account) => account.uuid)
      );
      const result = await window.readerAPI.importArchive();
      if (result.canceled) return;
      if (result.library) {
        const newlyImportedAccount = result.library.accounts.find(
          (account) => !existingAccountUuids.has(account.uuid)
        );
        const nextAccount =
          newlyImportedAccount ||
          result.library.accounts.find(
            (account) => account.uuid === activeAccountUuid
          ) ||
          result.library.accounts[0];
        const nextConversations = nextAccount
          ? result.library.conversations.filter(
              (conversation) => conversation.account_uuid === nextAccount.uuid
            )
          : [];
        const nextMemory = nextAccount
          ? result.library.memories.some(
              (memory) => memory.account_uuid === nextAccount.uuid
            )
          : false;

        setLibrary(result.library);
        setSelectedAccountUuid(nextAccount?.uuid);
        if (nextAccount?.uuid) {
          localStorage.setItem("selected-account-uuid", nextAccount.uuid);
        }
        setGlobalSearchQuery("");
        setGlobalSearchOpen(false);
        setSearchTarget(undefined);
        setConversationFindOpen(false);
        setConversationFindQuery("");
        setSelectedMemoryFilePath(undefined);
        setSelectedKey(
          nextConversations[0]
            ? conversationKey(nextConversations[0])
            : undefined
        );
        if (!nextConversations.length && nextMemory) {
          setPrimaryView("memory");
        } else if (nextConversations.length) {
          setPrimaryView("conversation");
        }
      }
      setNotice(
        result.duplicate
          ? result.importedMemories
            ? `这个导出包已经导入过；已同步 ${result.importedMemories} 份账户记忆。`
            : "这个导出包已经导入过了。"
          : `已导入 ${result.importedConversations || 0} 个会话${
              result.importedMemories
                ? `和 ${result.importedMemories} 份账户记忆`
                : ""
            }。`
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "导入失败，请检查 ZIP。");
    } finally {
      setImporting(false);
    }
  }

  function selectConversation(conversation: Conversation) {
    if (conversation.account_uuid !== activeAccountUuid) return;
    setPrimaryView("conversation");
    setSelectedKey(conversationKey(conversation));
    setSearchTarget(undefined);
    setConversationFindOpen(false);
    setConversationFindQuery("");
    window.requestAnimationFrame(() => {
      document.querySelector(".conversation-scroll")?.scrollTo({ top: 0 });
    });
  }

  function selectAccount(accountUuid: string) {
    if (
      accountUuid === activeAccountUuid ||
      !library.accounts.some((account) => account.uuid === accountUuid)
    ) {
      return;
    }

    const nextConversations = library.conversations.filter(
      (conversation) => conversation.account_uuid === accountUuid
    );
    const nextMemory = memoryRecords.find(
      (memory) => memory.account_uuid === accountUuid
    );
    setSelectedAccountUuid(accountUuid);
    localStorage.setItem("selected-account-uuid", accountUuid);
    setSelectedKey(
      nextConversations[0] ? conversationKey(nextConversations[0]) : undefined
    );
    setGlobalSearchQuery("");
    setGlobalSearchOpen(false);
    setSearchTarget(undefined);
    setConversationFindOpen(false);
    setConversationFindQuery("");
    setSelectedMemoryFilePath(undefined);
    setSelectedProjectMemoryUuid(undefined);

    if (primaryView === "memory" && !nextMemory && nextConversations.length) {
      setPrimaryView("conversation");
    } else if (
      primaryView === "conversation" &&
      !nextConversations.length &&
      nextMemory
    ) {
      setPrimaryView("memory");
    }

    setFontMenuOpen(false);
    scrollMainToTop();
  }

  async function toggleConversationPinned(conversation: Conversation) {
    const key = conversationKey(conversation);
    if (pinningKeys.has(key)) return;
    const pinned = !pinnedKeys.has(key);
    setPinningKeys((current) => new Set(current).add(key));

    try {
      if (window.readerAPI) {
        setLibrary(
          await window.readerAPI.setConversationPinned(key, pinned)
        );
      } else {
        setLibrary((current) => ({
          ...current,
          pinned_conversations: pinned
            ? [
                {
                  conversation_key: key,
                  pinned_at: new Date().toISOString()
                },
                ...(current.pinned_conversations || []).filter(
                  (item) => item.conversation_key !== key
                )
              ]
            : (current.pinned_conversations || []).filter(
                (item) => item.conversation_key !== key
              )
        }));
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "无法更新收藏状态。"
      );
    } finally {
      setPinningKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  function scrollMainToTop() {
    window.requestAnimationFrame(() => {
      document.querySelector(".conversation-scroll")?.scrollTo({ top: 0 });
    });
  }

  function openMemory() {
    setPrimaryView("memory");
    setSelectedMemoryFilePath(undefined);
    setSearchTarget(undefined);
    setConversationFindOpen(false);
    setConversationFindQuery("");
    if (!hasActiveAccountMemory && memoryProjectOptions.length) {
      setMemoryScope("project");
    }
    setFontMenuOpen(false);
    scrollMainToTop();
  }

  function selectMemoryScope(scope: MemoryScope) {
    setMemoryScope(scope);
    setSelectedMemoryFilePath(undefined);
    scrollMainToTop();
  }

  function selectProjectMemory(projectUuid: string) {
    setSelectedProjectMemoryUuid(projectUuid);
    setSelectedMemoryFilePath(undefined);
    scrollMainToTop();
  }

  function selectMemoryFile(path: string | undefined) {
    setSelectedMemoryFilePath(path);
    scrollMainToTop();
  }

  function openGlobalSearch() {
    setConversationFindOpen(false);
    setGlobalSearchOpen(true);
    setFontMenuOpen(false);
  }

  function openConversationFind() {
    if (!selectedKey || primaryView !== "conversation") return;
    setGlobalSearchOpen(false);
    setSearchTarget(undefined);
    setConversationFindOpen(true);
    setConversationFindFocusSequence((value) => value + 1);
    setFontMenuOpen(false);
  }

  function closeConversationFind() {
    setConversationFindOpen(false);
    window.requestAnimationFrame(() => {
      conversationFindButtonRef.current?.focus();
    });
  }

  function updateConversationFindQuery(nextQuery: string) {
    setConversationFindQuery(nextQuery);
    setConversationFindMatchIds([]);
    setConversationFindActiveIndex(0);
  }

  function navigateConversationFind(direction: 1 | -1) {
    const matchCount = conversationFindMatchIds.length;
    if (!matchCount) return;
    setConversationFindActiveIndex(
      (current) => (current + direction + matchCount) % matchCount
    );
  }

  function selectSearchMessage(
    conversation: Conversation,
    messageId: string,
    query: string
  ) {
    const nextConversationKey = conversationKey(conversation);
    searchSequence.current += 1;
    setConversationFindOpen(false);
    setConversationFindQuery("");
    setPrimaryView("conversation");
    setSelectedKey(nextConversationKey);
    setSearchTarget({
      conversationKey: nextConversationKey,
      messageId,
      query: normalizeSearchText(query),
      sequence: searchSequence.current
    });
  }

  function panelMaximum(side: PanelSide) {
    const otherWidth =
      side === "sidebar"
        ? outlineOpen
          ? effectivePanelWidths.outline
          : 0
        : sidebarOpen
          ? effectivePanelWidths.sidebar
          : 0;
    const openCount = Number(sidebarOpen) + Number(outlineOpen);
    const available =
      viewportWidth -
      mainMinimumWidth(viewportWidth) -
      openCount * RESIZER_WIDTH -
      otherWidth;
    return Math.max(
      PANEL_LIMITS[side].minimum,
      Math.min(PANEL_LIMITS[side].maximum, available)
    );
  }

  function updatePanelWidth(
    side: PanelSide,
    nextValue: number,
    persist: boolean
  ) {
    const currentWidths = {
      sidebar: sidebarOpen
        ? effectivePanelWidths.sidebar
        : panelWidthsRef.current.sidebar,
      outline: outlineOpen
        ? effectivePanelWidths.outline
        : panelWidthsRef.current.outline
    };
    const next = {
      ...currentWidths,
      [side]: Math.round(
        Math.min(
          panelMaximum(side),
          Math.max(PANEL_LIMITS[side].minimum, nextValue)
        )
      )
    };
    panelWidthsRef.current = next;
    setPanelWidths(next);
    if (persist) {
      localStorage.setItem("panel-widths-v1", JSON.stringify(next));
    }
  }

  function beginPanelResize(
    side: PanelSide,
    event: ReactPointerEvent<HTMLDivElement>
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeResize.current = {
      side,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: effectivePanelWidths[side]
    };
    setResizingSide(side);
    document.documentElement.classList.add("is-resizing");
  }

  function movePanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = activeResize.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const movement = event.clientX - resize.startX;
    const nextValue =
      resize.startWidth + (resize.side === "sidebar" ? movement : -movement);
    updatePanelWidth(resize.side, nextValue, false);
  }

  function finishPanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = activeResize.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    activeResize.current = undefined;
    setResizingSide(undefined);
    document.documentElement.classList.remove("is-resizing");
    localStorage.setItem(
      "panel-widths-v1",
      JSON.stringify(panelWidthsRef.current)
    );
  }

  function resizePanelWithKeyboard(
    side: PanelSide,
    event: ReactKeyboardEvent<HTMLDivElement>
  ) {
    const step = event.shiftKey ? 30 : 10;
    const current = effectivePanelWidths[side];
    let nextValue: number | undefined;
    if (event.key === "Home") nextValue = PANEL_LIMITS[side].minimum;
    if (event.key === "End") nextValue = panelMaximum(side);
    if (side === "sidebar" && event.key === "ArrowLeft") {
      nextValue = current - step;
    }
    if (side === "sidebar" && event.key === "ArrowRight") {
      nextValue = current + step;
    }
    if (side === "outline" && event.key === "ArrowLeft") {
      nextValue = current + step;
    }
    if (side === "outline" && event.key === "ArrowRight") {
      nextValue = current - step;
    }
    if (nextValue === undefined) return;
    event.preventDefault();
    updatePanelWidth(side, nextValue, true);
  }

  function resetPanelWidth(side: PanelSide) {
    updatePanelWidth(side, DEFAULT_PANEL_WIDTHS[side], true);
  }

  function navigateToHeading(id: string) {
    const scroller = document.querySelector<HTMLElement>(".conversation-scroll");
    const target = document.getElementById(id);
    if (!scroller || !target || !scroller.contains(target)) return;
    const targetTop =
      scroller.scrollTop +
      target.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top -
      76;
    scroller.scrollTo({
      top: Math.max(0, targetTop),
      behavior: "smooth"
    });
    setActiveHeading(id);
  }

  const appStyle = {
    "--sidebar-width": `${effectivePanelWidths.sidebar}px`,
    "--outline-width": `${effectivePanelWidths.outline}px`
  } as CSSProperties;

  return (
    <div
      className={`app-shell ${sidebarOpen ? "" : "sidebar-closed"} ${
        outlineOpen ? "" : "outline-closed"
      }`}
      style={appStyle}
    >
      {sidebarOpen && (
        <Sidebar
          library={library}
          activeAccountUuid={activeAccountUuid}
          pinnedConversations={pinnedConversations}
          recentConversations={recentConversations}
          pinnedKeys={pinnedKeys}
          pinningKeys={pinningKeys}
          selectedKey={
            primaryView === "conversation" ? selectedKey : undefined
          }
          memoryActive={primaryView === "memory"}
          onSelect={selectConversation}
          onTogglePinned={toggleConversationPinned}
          onOpenMemory={openMemory}
          onOpenSearch={openGlobalSearch}
          onSelectAccount={selectAccount}
          onImport={importArchive}
          importing={importing}
        />
      )}
      {sidebarOpen && (
        <PanelResizer
          side="sidebar"
          value={effectivePanelWidths.sidebar}
          minimum={PANEL_LIMITS.sidebar.minimum}
          maximum={panelMaximum("sidebar")}
          active={resizingSide === "sidebar"}
          onPointerDown={beginPanelResize}
          onPointerMove={movePanelResize}
          onPointerEnd={finishPanelResize}
          onKeyDown={resizePanelWithKeyboard}
          onDoubleClick={resetPanelWidth}
        />
      )}

      <main className="main-pane">
        <header className="topbar">
          <button
            className="icon-button"
            onClick={() => setSidebarOpen((value) => !value)}
            aria-label="显示或隐藏左侧栏"
            title="显示或隐藏左侧栏"
          >
            <MenuIcon />
          </button>
          <div
            className="topbar-title"
            role={primaryView === "conversation" ? "heading" : undefined}
            aria-level={primaryView === "conversation" ? 1 : undefined}
            tabIndex={primaryView === "conversation" ? -1 : undefined}
            title={
              primaryView === "conversation" && selectedConversation
                ? conversationDisplayTitle(selectedConversation)
                : primaryView === "memory"
                  ? "Memory"
                  : undefined
            }
          >
            {primaryView === "conversation" && selectedConversation
              ? conversationDisplayTitle(selectedConversation)
              : primaryView === "memory"
                ? "Memory"
                : ""}
          </div>
          <div className="topbar-actions">
            {primaryView === "conversation" && selectedConversation && (
              <button
                className={`icon-button conversation-pin-topbar ${
                  pinnedKeys.has(conversationKey(selectedConversation))
                    ? "is-pinned"
                    : ""
                }`}
                onClick={() => toggleConversationPinned(selectedConversation)}
                disabled={pinningKeys.has(
                  conversationKey(selectedConversation)
                )}
                aria-label={
                  pinnedKeys.has(conversationKey(selectedConversation))
                    ? "取消收藏此对话"
                    : "收藏并置顶此对话"
                }
                aria-pressed={pinnedKeys.has(
                  conversationKey(selectedConversation)
                )}
                title={
                  pinnedKeys.has(conversationKey(selectedConversation))
                    ? "取消收藏"
                    : "收藏并置顶"
                }
              >
                <StarIcon />
              </button>
            )}
            <button
              ref={conversationFindButtonRef}
              className={`icon-button ${
                conversationFindOpen ? "is-active" : ""
              }`}
              onClick={openConversationFind}
              disabled={
                primaryView !== "conversation" || !selectedConversation
              }
              aria-label="在当前对话中查找"
              aria-controls="conversation-findbar"
              aria-expanded={conversationFindOpen}
              title="在当前对话中查找（Ctrl + F）"
            >
              <SearchIcon />
            </button>
            <button
              className="icon-button"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              aria-label="切换主题"
              title="切换主题"
            >
              {theme === "light" ? <MoonIcon /> : <SunIcon />}
            </button>
            <div className="font-settings-anchor">
              <button
                className={`icon-button font-button ${fontMenuOpen ? "is-active" : ""}`}
                onClick={() => setFontMenuOpen((value) => !value)}
                aria-label="调整字体大小"
                title="调整字体大小"
              >
                Aa
              </button>
              {fontMenuOpen && (
                <div className="font-popover">
                  <div className="font-popover-title">字体大小</div>
                  {(
                    [
                      ["chat", "正文", 14, 22],
                      ["sidebar", "左侧会话栏", 11, 18],
                      ["outline", "右侧导航栏", 11, 18]
                    ] as const
                  ).map(([key, label, min, max]) => (
                    <label key={key}>
                      <span>
                        {label}
                        <strong>{fontSettings[key]} px</strong>
                      </span>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step="1"
                        value={fontSettings[key]}
                        onChange={(event) =>
                          setFontSettings((current) => ({
                            ...current,
                            [key]: Number(event.target.value)
                          }))
                        }
                      />
                    </label>
                  ))}
                  <button
                    className="font-reset"
                    onClick={() => setFontSettings(DEFAULT_FONT_SETTINGS)}
                  >
                    恢复默认
                  </button>
                </div>
              )}
            </div>
            <button
              className={`icon-button outline-toggle ${outlineOpen ? "is-active" : ""}`}
              onClick={() => setOutlineOpen((value) => !value)}
              aria-label={
                outlineOpen
                  ? `隐藏${primaryView === "memory" ? "记忆目录" : "对话导航"}`
                  : `显示${primaryView === "memory" ? "记忆目录" : "对话导航"}`
              }
              aria-controls="conversation-outline"
              aria-expanded={outlineOpen}
              title={`${outlineOpen ? "隐藏" : "显示"}${
                primaryView === "memory" ? "记忆目录" : "对话导航"
              }（Ctrl + Shift + O）`}
            >
              <OutlineIcon />
            </button>
          </div>
        </header>

        {primaryView === "conversation" &&
          conversationFindOpen &&
          selectedConversation && (
          <div id="conversation-findbar">
            <ConversationFindBar
              query={conversationFindQuery}
              activeIndex={conversationFindActiveIndex}
              matchCount={conversationFindMatchIds.length}
              pending={conversationFindPending}
              focusSequence={conversationFindFocusSequence}
              onQueryChange={updateConversationFindQuery}
              onPrevious={() => navigateConversationFind(-1)}
              onNext={() => navigateConversationFind(1)}
              onClose={closeConversationFind}
            />
          </div>
        )}

        {notice && (
          <button className="notice" onClick={() => setNotice(undefined)}>
            {notice}
          </button>
        )}

        <div className="conversation-scroll">
          {primaryView === "memory" ? (
            <MemoryPage
              account={activeAccount}
              document={memoryDocument}
              memory={activeMemory}
              projectOptions={memoryProjectOptions}
              scope={memoryScope}
              structuredAccountMode={structuredAccountMode}
              structuredMemory={structuredMemory}
              selectedMemoryFilePath={selectedMemoryFilePath}
              selectedProjectUuid={activeProjectMemoryUuid}
              onMemoryFileChange={selectMemoryFile}
              onProjectChange={selectProjectMemory}
              onScopeChange={selectMemoryScope}
            />
          ) : selectedConversation ? (
            <div className="conversation">
              {messages.map((message) => (
                <MessageView
                  key={message.uuid}
                  message={message}
                  highlightQuery={
                    (!conversationFindPending &&
                    conversationFindHighlightQuery &&
                    conversationFindMatchingMessageIds.has(message.uuid)
                      ? conversationFindHighlightQuery
                      : undefined) ||
                    (searchTarget &&
                    searchTarget.conversationKey === selectedKey &&
                    searchTarget.messageId === message.uuid
                      ? searchTarget.query
                      : undefined)
                  }
                />
              ))}
              <footer className="archive-footer">
                已到达归档末尾 · 原始记录保持只读
              </footer>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-mark">C</div>
              <h1>重新打开曾经的对话</h1>
              <p>
                选择 Claude Export ZIP，文件仅在本机处理，不会上传。
              </p>
              <button className="primary-action large" onClick={importArchive}>
                <ImportIcon />
                导入数据
              </button>
            </div>
          )}
        </div>
      </main>

      {outlineOpen && (
        <PanelResizer
          side="outline"
          value={effectivePanelWidths.outline}
          minimum={PANEL_LIMITS.outline.minimum}
          maximum={panelMaximum("outline")}
          active={resizingSide === "outline"}
          onPointerDown={beginPanelResize}
          onPointerMove={movePanelResize}
          onPointerEnd={finishPanelResize}
          onKeyDown={resizePanelWithKeyboard}
          onDoubleClick={resetPanelWidth}
        />
      )}
      {outlineOpen && (
        primaryView === "memory" ? (
          structuredAccountMode ? (
            <StructuredMemoryOutline
              memory={structuredMemory}
              selectedPath={selectedMemoryFilePath}
              onSelect={selectMemoryFile}
              onClose={() => setOutlineOpen(false)}
            />
          ) : (
            <MemoryOutline
              headings={memoryDocument.headings}
              activeId={activeHeading}
              onNavigate={navigateToHeading}
              onClose={() => setOutlineOpen(false)}
            />
          )
        ) : (
          <Outline
            headings={conversationHeadings}
            activeId={activeHeading}
            onNavigate={navigateToHeading}
            onClose={() => setOutlineOpen(false)}
          />
        )
      )}

      <GlobalSearchDialog
        open={globalSearchOpen}
        query={globalSearchQuery}
        results={globalSearchResults}
        accountName={activeAccount ? accountDisplayName(activeAccount) : undefined}
        onQueryChange={setGlobalSearchQuery}
        onSelectConversation={(conversation) => {
          selectConversation(conversation);
          setGlobalSearchOpen(false);
          window.requestAnimationFrame(() => {
            const heading = document.querySelector<HTMLElement>(".topbar-title");
            if (!heading) return;
            heading.focus({ preventScroll: true });
          });
        }}
        onSelectMessage={(conversation, messageId, query) => {
          selectSearchMessage(conversation, messageId, query);
          setGlobalSearchOpen(false);
        }}
        onRequestClose={() => setGlobalSearchOpen(false)}
      />
    </div>
  );
}
