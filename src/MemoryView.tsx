import type { Account, MemoryRecord } from "./types";
import type {
  MemoryHeading,
  MemoryProjectOption,
  MemoryScope,
  PreparedMemoryDocument,
  PreparedStructuredMemory
} from "./memory";
import MarkdownBlock from "./MarkdownBlock";
import { ArrowLeftIcon, ChevronIcon } from "./icons";

interface MemoryPageProps {
  account?: Account;
  document: PreparedMemoryDocument;
  memory?: MemoryRecord;
  projectOptions: MemoryProjectOption[];
  scope: MemoryScope;
  structuredAccountMode: boolean;
  structuredMemory: PreparedStructuredMemory;
  selectedMemoryFilePath?: string;
  selectedProjectUuid?: string;
  onMemoryFileChange: (path: string | undefined) => void;
  onProjectChange: (projectUuid: string) => void;
  onScopeChange: (scope: MemoryScope) => void;
}

function accountLabel(account: Account | undefined, accountUuid?: string) {
  return account?.full_name || account?.email_address || accountUuid || "未命名账户";
}

export default function MemoryPage({
  account,
  document,
  memory,
  projectOptions,
  scope,
  structuredAccountMode,
  structuredMemory,
  selectedMemoryFilePath,
  selectedProjectUuid,
  onMemoryFileChange,
  onProjectChange,
  onScopeChange
}: MemoryPageProps) {
  const selectedProject = projectOptions.find(
    (project) => project.uuid === selectedProjectUuid
  );
  const hasAccountMemory = Boolean(
    memory?.conversations_memory?.trim() ||
      memory?.memory_files?.some((file) => file.content.trim())
  );
  const hasProjectMemory = projectOptions.length > 0;
  const pageTitle = structuredAccountMode
    ? "Memory"
    : scope === "account"
      ? "Account Memory"
      : "Project Memory";
  const subtitle =
    scope === "account"
      ? accountLabel(account, memory?.account_uuid || account?.uuid)
      : selectedProject?.name || "未选择项目";

  return (
    <div
      className={`memory-page ${
        structuredAccountMode ? "structured-memory-page" : ""
      }`}
    >
      <header className="memory-page-heading">
        <span className="memory-eyebrow">Claude Memory · 本地只读</span>
        <h1>{pageTitle}</h1>
        <p>{subtitle}</p>
      </header>

      <div className="memory-controls">
        <span className="memory-account-chip">
          {accountLabel(account, memory?.account_uuid || account?.uuid)}
        </span>

        <div className="memory-tabs" role="tablist" aria-label="记忆类型">
          <button
            type="button"
            role="tab"
            aria-selected={scope === "account"}
            aria-label={
              hasAccountMemory
                ? "Account Memory"
                : "Account Memory（导出数据中未包含内容）"
            }
            className={scope === "account" ? "is-active" : ""}
            onClick={() => onScopeChange("account")}
          >
            Account Memory
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === "project"}
            className={scope === "project" ? "is-active" : ""}
            disabled={!hasProjectMemory}
            onClick={() => onScopeChange("project")}
          >
            Project Memory
          </button>
        </div>

        {scope === "project" && projectOptions.length > 0 && (
          <label className="memory-select memory-project-select">
            <span>项目</span>
            <select
              value={selectedProjectUuid || ""}
              onChange={(event) => onProjectChange(event.target.value)}
            >
              {projectOptions.map((project) => (
                <option value={project.uuid} key={project.uuid}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {structuredAccountMode ? (
        <StructuredMemoryBrowser
          memory={structuredMemory}
          selectedPath={selectedMemoryFilePath}
          anchorPrefix={document.anchorPrefix}
          onSelect={onMemoryFileChange}
        />
      ) : document.markdown ? (
        <article className="memory-document">
          <MarkdownBlock
            text={document.markdown}
            anchorPrefix={document.anchorPrefix}
          />
        </article>
      ) : (
        <div className="memory-empty">
          <strong>没有可显示的 Memory</strong>
          <p>
            {memory
              ? scope === "account"
                ? "当前账户的导出数据中没有 Account Memory；Project Memory 仍可单独查看。"
                : "当前项目没有导出的 Project Memory。"
              : "请重新导入包含 memories.json 的 Claude Export ZIP。"}
          </p>
        </div>
      )}

      <footer className="archive-footer">
        Memory 来自 Claude 导出数据 · 原始记录保持只读
      </footer>
    </div>
  );
}

function updatedLabel(value: string | undefined) {
  if (!value) return "";
  const updated = new Date(value);
  if (Number.isNaN(updated.getTime())) return "";
  const now = new Date();
  const days = Math.max(
    0,
    Math.floor((now.getTime() - updated.getTime()) / 86_400_000)
  );
  if (days === 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  if (days < 7) return `Updated ${days} days ago`;
  return `Updated ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: updated.getFullYear() === now.getFullYear() ? undefined : "numeric"
  }).format(updated)}`;
}

function StructuredMemoryBrowser({
  memory,
  selectedPath,
  anchorPrefix,
  onSelect
}: {
  memory: PreparedStructuredMemory;
  selectedPath?: string;
  anchorPrefix: string;
  onSelect: (path: string | undefined) => void;
}) {
  const selected = memory.entries.find((entry) => entry.path === selectedPath);

  if (selected) {
    return (
      <section className="structured-memory-detail">
        <button
          type="button"
          className="structured-memory-back"
          onClick={() => onSelect(undefined)}
        >
          <ArrowLeftIcon />
          Memory
        </button>
        <div className="structured-memory-detail-heading">
          <h2>{selected.title}</h2>
          {selected.updatedAt && <span>{updatedLabel(selected.updatedAt)}</span>}
        </div>
        <section className="structured-memory-section">
          <h3>Summary</h3>
          <p>{selected.description || "No summary provided."}</p>
        </section>
        <section className="structured-memory-section">
          <h3>Details</h3>
          {selected.details ? (
            <MarkdownBlock
              text={selected.details}
              anchorPrefix={`${anchorPrefix}-detail`}
            />
          ) : (
            <p className="structured-memory-no-details">No details stored.</p>
          )}
        </section>
      </section>
    );
  }

  return (
    <section className="structured-memory-list" aria-label="Memory entries">
      {memory.groups.map((group) => (
        <section
          className="structured-memory-group"
          id={`${anchorPrefix}-group-${group.key}`}
          key={group.key}
        >
          <h2>{group.label}</h2>
          <div className="structured-memory-rows">
            {group.entries.map((entry) => (
              <button
                type="button"
                className="structured-memory-row"
                key={entry.path}
                onClick={() => onSelect(entry.path)}
                title={`Open ${entry.title}`}
              >
                <strong>{entry.title}</strong>
                <span className="structured-memory-summary">
                  {entry.description || "No summary provided."}
                </span>
                <span className="structured-memory-updated">
                  {updatedLabel(entry.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

export function StructuredMemoryOutline({
  memory,
  selectedPath,
  onSelect,
  onClose
}: {
  memory: PreparedStructuredMemory;
  selectedPath?: string;
  onSelect: (path: string | undefined) => void;
  onClose: () => void;
}) {
  return (
    <aside className="outline structured-memory-outline" id="conversation-outline">
      <div className="outline-header">
        <div className="outline-title">Memory</div>
        <button
          className="outline-close"
          onClick={onClose}
          aria-label="隐藏 Memory 导航"
          title="隐藏 Memory 导航"
        >
          <ChevronIcon />
        </button>
      </div>
      <nav>
        {memory.groups.map((group) => (
          <div className="structured-memory-outline-group" key={group.key}>
            <span>{group.label}</span>
            {group.entries.map((entry) => (
              <button
                type="button"
                className={selectedPath === entry.path ? "is-active" : ""}
                key={entry.path}
                title={entry.title}
                onClick={() => onSelect(entry.path)}
              >
                {entry.title}
              </button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

export function MemoryOutline({
  headings,
  activeId,
  onNavigate,
  onClose
}: {
  headings: MemoryHeading[];
  activeId?: string;
  onNavigate: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <aside className="outline memory-outline" id="conversation-outline">
      <div className="outline-header">
        <div className="outline-title">记忆目录</div>
        <button
          className="outline-close"
          onClick={onClose}
          aria-label="收起记忆目录"
          title="收起记忆目录"
        >
          <ChevronIcon />
        </button>
      </div>
      {headings.length ? (
        <nav>
          {headings.map((heading) => (
            <button
              type="button"
              key={heading.id}
              className={`memory-outline-entry memory-level-${Math.min(
                heading.level,
                3
              )} ${activeId === heading.id ? "is-active" : ""}`}
              title={heading.text}
              onClick={() => onNavigate(heading.id)}
            >
              <span className="outline-entry-text">{heading.text}</span>
            </button>
          ))}
        </nav>
      ) : (
        <p>当前 Memory 没有可用于目录的原始标题。</p>
      )}
    </aside>
  );
}
