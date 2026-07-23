import { useEffect, useMemo, useState } from "react";
import type { Conversation, HeadingEntry, Library } from "./types";
import { dateLabel, extractHeadings, visibleMessages } from "./conversation";
import MessageView from "./MessageView";
import { DEMO_LIBRARY } from "./demo";
import {
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

function Sidebar({
  library,
  selectedKey,
  onSelect,
  onImport,
  importing
}: {
  library: Library;
  selectedKey?: string;
  onSelect: (conversation: Conversation) => void;
  onImport: () => void;
  importing: boolean;
}) {
  const [query, setQuery] = useState("");
  const conversations = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return [...library.conversations]
      .filter((conversation) =>
        normalized
          ? `${conversation.name || ""} ${conversation.summary || ""}`
              .toLocaleLowerCase()
              .includes(normalized)
          : true
      )
      .sort(
        (a, b) =>
          new Date(b.updated_at || b.created_at || 0).getTime() -
          new Date(a.updated_at || a.created_at || 0).getTime()
      );
  }, [library.conversations, query]);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">C</div>
        <div>
          <strong>Claude 数据阅读器</strong>
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
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索聊天"
        />
      </label>

      <div className="sidebar-section-title">
        <span>最近聊天</span>
        <span>{conversations.length}</span>
      </div>

      <nav className="conversation-list">
        {conversations.map((conversation) => (
          <button
            key={`${conversation.account_uuid}:${conversation.uuid}`}
            className={
              selectedKey === `${conversation.account_uuid}:${conversation.uuid}`
                ? "is-active"
                : ""
            }
            onClick={() => onSelect(conversation)}
          >
            <span className="conversation-title">
              {conversation.name || "未命名会话"}
            </span>
            <span className="conversation-date">
              {dateLabel(conversation.updated_at || conversation.created_at)}
            </span>
          </button>
        ))}
      </nav>

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
  onNavigate
}: {
  headings: HeadingEntry[];
  activeId?: string;
  onNavigate: (id: string) => void;
}) {
  return (
    <aside className="outline">
      <div className="outline-title">本页目录</div>
      {headings.length ? (
        <nav>
          {headings.map((heading) => (
            <button
              key={heading.id}
              className={activeId === heading.id ? "is-active" : ""}
              style={{ paddingLeft: `${10 + (heading.level - 1) * 10}px` }}
              title={heading.text}
              onClick={() => onNavigate(heading.id)}
            >
              {heading.text}
            </button>
          ))}
        </nav>
      ) : (
        <p>这段会话中没有标题</p>
      )}
    </aside>
  );
}

export default function App() {
  const [library, setLibrary] = useState<Library>(EMPTY_LIBRARY);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [outlineOpen, setOutlineOpen] = useState(
    () => localStorage.getItem("outline-open") !== "false"
  );
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("theme") as Theme) || "light"
  );
  const [activeHeading, setActiveHeading] = useState<string>();
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("outline-open", String(outlineOpen));
  }, [outlineOpen]);

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
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        setOutlineOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", keyboardShortcut);
    return () => window.removeEventListener("keydown", keyboardShortcut);
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
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveHeading(visible[0].target.id);
      },
      { rootMargin: "-12% 0px -75% 0px" }
    );
    headings.forEach((heading) => {
      const element = document.getElementById(heading.id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [headings, selectedKey]);

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

  function navigateToHeading(id: string) {
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
    setActiveHeading(id);
  }

  return (
    <div
      className={`app-shell ${sidebarOpen ? "" : "sidebar-closed"} ${
        outlineOpen && headings.length ? "" : "outline-closed"
      }`}
    >
      {sidebarOpen && (
        <Sidebar
          library={library}
          selectedKey={selectedKey}
          onSelect={(conversation) => {
            setSelectedKey(`${conversation.account_uuid}:${conversation.uuid}`);
            document.querySelector(".conversation-scroll")?.scrollTo({ top: 0 });
          }}
          onImport={importArchive}
          importing={importing}
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
            {selectedConversation?.name || "Claude 数据阅读器"}
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
            <button
              className={`icon-button ${outlineOpen ? "is-active" : ""}`}
              onClick={() => setOutlineOpen((value) => !value)}
              aria-label="显示或隐藏标题导航"
              title="标题导航（Ctrl + Shift + O）"
              disabled={!headings.length}
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
                <h1>{selectedConversation.name || "未命名会话"}</h1>
                {selectedConversation.summary && <p>{selectedConversation.summary}</p>}
              </div>
              {messages.map((message) => (
                <MessageView key={message.uuid} message={message} />
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
                导入 Claude 数据导出 ZIP。文件只在这台电脑上处理，不会上传。
              </p>
              <button className="primary-action large" onClick={importArchive}>
                <ImportIcon />
                导入数据
              </button>
            </div>
          )}
        </div>
      </main>

      {outlineOpen && headings.length > 0 && (
        <Outline
          headings={headings}
          activeId={activeHeading}
          onNavigate={navigateToHeading}
        />
      )}
    </div>
  );
}
