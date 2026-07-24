import {
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
import type { Conversation, HeadingEntry, Library } from "./types";
import { dateLabel, extractHeadings, visibleMessages } from "./conversation";
import MessageView from "./MessageView";
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
  ImportIcon,
  MenuIcon,
  MoonIcon,
  OutlineIcon,
  SearchIcon,
  SunIcon
} from "./icons";

const EMPTY_LIBRARY: Library = {
  version: 1,
  imports: [],
  accounts: [],
  conversations: [],
  projects: []
};

type Theme = "light" | "dark";
type PanelSide = "sidebar" | "outline";

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
  query,
  selectedKey,
  selectedMessageId,
  onSelect,
  onQueryChange,
  onSearchSelect,
  onImport,
  importing
}: {
  library: Library;
  query: string;
  selectedKey?: string;
  selectedMessageId?: string;
  onSelect: (conversation: Conversation) => void;
  onQueryChange: (query: string) => void;
  onSearchSelect: (
    conversation: Conversation,
    messageId: string,
    query: string
  ) => void;
  onImport: () => void;
  importing: boolean;
}) {
  const searchIndex = useMemo(
    () => buildConversationSearchIndex(library.conversations),
    [library.conversations]
  );
  const conversations = useMemo(
    () => searchIndex.map((entry) => entry.conversation),
    [searchIndex]
  );
  const searchResults = useMemo(
    () => searchConversationIndex(searchIndex, query),
    [query, searchIndex]
  );
  const searching = Boolean(normalizeSearchText(query));

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

      <label className="search">
        <SearchIcon />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索标题和消息"
          aria-label="搜索对话标题和消息全文"
        />
      </label>

      <div className="sidebar-section-title">
        <span>{searching ? "搜索结果" : "最近聊天"}</span>
        <span>
          {searching ? searchResults.totalMatches : conversations.length}
        </span>
      </div>

      {searching ? (
        <nav
          className="conversation-list search-result-list"
          aria-label="搜索结果"
        >
          {searchResults.groups.length ? (
            searchResults.groups.map((group) => (
              <section className="search-result-group" key={group.key}>
                <button
                  className={`search-result-conversation ${
                    selectedKey === group.key && !selectedMessageId
                      ? "is-active"
                      : ""
                  }`}
                  onClick={() => onSelect(group.conversation)}
                  title={conversationDisplayTitle(group.conversation)}
                >
                  <span className="conversation-title">
                    <HighlightedSearchText
                      text={conversationDisplayTitle(group.conversation)}
                      query={query}
                    />
                  </span>
                  <span className="search-result-conversation-meta">
                    {group.titleMatch && (
                      <span className="search-result-kind">标题</span>
                    )}
                    <span className="conversation-date">
                      {dateLabel(
                        group.conversation.updated_at ||
                          group.conversation.created_at
                      )}
                    </span>
                  </span>
                </button>
                {group.messageMatches.map(({ message, snippet }) => (
                  <button
                    className={`search-result-message ${
                      selectedKey === group.key &&
                      selectedMessageId === message.uuid
                        ? "is-active"
                        : ""
                    }`}
                    key={message.uuid}
                    onClick={() =>
                      onSearchSelect(
                        group.conversation,
                        message.uuid,
                        query
                      )
                    }
                    title={snippet}
                  >
                    <span className="search-result-message-meta">
                      <span>
                        {message.sender === "human" ? "你" : "Claude"}
                      </span>
                      <span>{dateLabel(message.created_at)}</span>
                    </span>
                    <span className="search-result-snippet">
                      <HighlightedSearchText
                        text={snippet}
                        query={query}
                      />
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
          {searchResults.truncated && (
            <div className="search-limit-note">
              共 {searchResults.totalMatches} 条结果，当前显示{" "}
              {searchResults.shownMatches} 条。
            </div>
          )}
        </nav>
      ) : (
        <nav className="conversation-list" aria-label="最近聊天">
          {conversations.map((conversation) => (
            <button
              key={conversationKey(conversation)}
              className={
                selectedKey === conversationKey(conversation)
                  ? "is-active"
                  : ""
              }
              onClick={() => onSelect(conversation)}
            >
              <span className="conversation-title">
                {conversationDisplayTitle(conversation)}
              </span>
              <span className="conversation-date">
                {dateLabel(conversation.updated_at || conversation.created_at)}
              </span>
            </button>
          ))}
        </nav>
      )}

      <div className="account-card">
        <div className="avatar">
          {(library.accounts[0]?.full_name || "本").slice(0, 1)}
        </div>
        <div>
          <strong>{library.accounts[0]?.full_name || "本地阅读器"}</strong>
          <span>
            {library.accounts.length
              ? `${library.accounts.length} 个账户 · ${library.imports.length} 次导入`
              : "尚未导入数据"}
          </span>
        </div>
      </div>
    </aside>
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
        <nav>
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
              }`}
              title={heading.fullText || heading.text}
              onClick={() => onNavigate(heading.id)}
              aria-expanded={
                heading.kind === "question"
                  ? heading.questionNumber === activeQuestionNumber
                  : undefined
              }
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
  const label = side === "sidebar" ? "左侧会话栏" : "右侧对话导航";
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
  const [selectedKey, setSelectedKey] = useState<string>();
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchTarget, setSearchTarget] = useState<SearchTarget>();
  const searchSequence = useRef(0);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string>();
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
    if (window.readerAPI) {
      window.readerAPI.getLibrary().then((nextLibrary) => {
        setLibrary(nextLibrary);
        const first = nextLibrary.conversations[0];
        setSelectedKey(first ? `${first.account_uuid}:${first.uuid}` : undefined);
      });
    } else if (new URLSearchParams(window.location.search).has("demo")) {
      setLibrary(DEMO_LIBRARY);
      const first = DEMO_LIBRARY.conversations[0];
      setSelectedKey(`${first.account_uuid}:${first.uuid}`);
    }
  }, []);

  useEffect(() => {
    function keyboardShortcut(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setFontMenuOpen(false);
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        setOutlineOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", keyboardShortcut);
    return () => window.removeEventListener("keydown", keyboardShortcut);
  }, []);

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
          `${conversation.account_uuid}:${conversation.uuid}` === selectedKey
      ),
    [library.conversations, selectedKey]
  );
  const messages = useMemo(
    () => visibleMessages(selectedConversation),
    [selectedConversation]
  );
  const headings = useMemo(() => extractHeadings(messages), [messages]);

  useEffect(() => {
    if (!headings.length) {
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
    headings.forEach((heading) => {
      const element = document.getElementById(heading.id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [headings, selectedKey]);

  useEffect(() => {
    if (!searchTarget || searchTarget.conversationKey !== selectedKey) return;

    const frame = window.requestAnimationFrame(() => {
      const scroller =
        document.querySelector<HTMLElement>(".conversation-scroll");
      const message = document.getElementById(
        `message-${searchTarget.messageId}`
      );
      if (!scroller || !message || !scroller.contains(message)) return;

      const target =
        message.querySelector<HTMLElement>(".search-highlight") || message;
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
  }, [messages, searchTarget, selectedKey]);

  async function importArchive() {
    if (!window.readerAPI) {
      setNotice("请在桌面应用中使用导入功能。");
      return;
    }
    setImporting(true);
    setNotice(undefined);
    try {
      const result = await window.readerAPI.importArchive();
      if (result.canceled) return;
      if (result.library) {
        setLibrary(result.library);
        setSearchQuery("");
        setSearchTarget(undefined);
        setSelectedKey((current) => {
          if (current) return current;
          const first = result.library?.conversations[0];
          return first ? `${first.account_uuid}:${first.uuid}` : undefined;
        });
      }
      setNotice(
        result.duplicate
          ? "这个导出包已经导入过了。"
          : `已导入 ${result.importedConversations || 0} 个会话。`
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "导入失败，请检查 ZIP。");
    } finally {
      setImporting(false);
    }
  }

  function selectConversation(conversation: Conversation) {
    setSelectedKey(conversationKey(conversation));
    setSearchTarget(undefined);
    window.requestAnimationFrame(() => {
      document.querySelector(".conversation-scroll")?.scrollTo({ top: 0 });
    });
  }

  function updateSearchQuery(nextQuery: string) {
    setSearchQuery(nextQuery);
    setSearchTarget(undefined);
  }

  function selectSearchMessage(
    conversation: Conversation,
    messageId: string,
    query: string
  ) {
    const nextConversationKey = conversationKey(conversation);
    searchSequence.current += 1;
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
          query={searchQuery}
          selectedKey={selectedKey}
          selectedMessageId={searchTarget?.messageId}
          onSelect={selectConversation}
          onQueryChange={updateSearchQuery}
          onSearchSelect={selectSearchMessage}
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
          <div className="topbar-title">
            {selectedConversation
              ? conversationDisplayTitle(selectedConversation)
              : "Claude 导出数据阅读器"}
          </div>
          <div className="topbar-actions">
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
                      ["chat", "聊天正文", 14, 22],
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
              aria-label={outlineOpen ? "隐藏对话导航" : "显示对话导航"}
              aria-controls="conversation-outline"
              aria-expanded={outlineOpen}
              title={`${outlineOpen ? "隐藏" : "显示"}对话导航（Ctrl + Shift + O）`}
            >
              <OutlineIcon />
            </button>
          </div>
        </header>

        {notice && (
          <button className="notice" onClick={() => setNotice(undefined)}>
            {notice}
          </button>
        )}

        <div className="conversation-scroll">
          {selectedConversation ? (
            <div className="conversation">
              <div className="conversation-heading">
                <h1>{conversationDisplayTitle(selectedConversation)}</h1>
              </div>
              {messages.map((message) => (
                <MessageView
                  key={message.uuid}
                  message={message}
                  highlightQuery={
                    searchTarget &&
                    searchTarget.conversationKey === selectedKey &&
                    searchTarget.messageId === message.uuid
                      ? searchTarget.query
                      : undefined
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
        <Outline
          headings={headings}
          activeId={activeHeading}
          onNavigate={navigateToHeading}
          onClose={() => setOutlineOpen(false)}
        />
      )}
    </div>
  );
}
