import type { Account, MemoryRecord } from "./types";
import type {
  MemoryHeading,
  MemoryProjectOption,
  MemoryScope,
  PreparedMemoryDocument
} from "./memory";
import MarkdownBlock from "./MarkdownBlock";
import { ChevronIcon } from "./icons";

interface MemoryPageProps {
  accounts: Account[];
  document: PreparedMemoryDocument;
  memory?: MemoryRecord;
  projectOptions: MemoryProjectOption[];
  scope: MemoryScope;
  selectedAccountUuid?: string;
  selectedProjectUuid?: string;
  onAccountChange: (accountUuid: string) => void;
  onProjectChange: (projectUuid: string) => void;
  onScopeChange: (scope: MemoryScope) => void;
}

function accountLabel(account: Account | undefined, accountUuid?: string) {
  return account?.full_name || account?.email_address || accountUuid || "未命名账户";
}

export default function MemoryPage({
  accounts,
  document,
  memory,
  projectOptions,
  scope,
  selectedAccountUuid,
  selectedProjectUuid,
  onAccountChange,
  onProjectChange,
  onScopeChange
}: MemoryPageProps) {
  const account = accounts.find((item) => item.uuid === selectedAccountUuid);
  const selectedProject = projectOptions.find(
    (project) => project.uuid === selectedProjectUuid
  );
  const hasAccountMemory = Boolean(memory?.conversations_memory?.trim());
  const hasProjectMemory = projectOptions.length > 0;
  const pageTitle =
    scope === "account" ? "Account Memory" : "Project Memory";
  const subtitle =
    scope === "account"
      ? accountLabel(account, selectedAccountUuid)
      : selectedProject?.name || "未选择项目";

  return (
    <div className="memory-page">
      <header className="memory-page-heading">
        <span className="memory-eyebrow">Claude Memory · 本地只读</span>
        <h1>{pageTitle}</h1>
        <p>{subtitle}</p>
      </header>

      <div className="memory-controls">
        {accounts.length > 1 ? (
          <label className="memory-select">
            <span>账户</span>
            <select
              value={selectedAccountUuid || ""}
              onChange={(event) => onAccountChange(event.target.value)}
            >
              {accounts.map((item) => (
                <option value={item.uuid} key={item.uuid}>
                  {accountLabel(item, item.uuid)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="memory-account-chip">
            {accountLabel(account, selectedAccountUuid)}
          </span>
        )}

        <div className="memory-tabs" role="tablist" aria-label="记忆类型">
          <button
            type="button"
            role="tab"
            aria-selected={scope === "account"}
            className={scope === "account" ? "is-active" : ""}
            disabled={!hasAccountMemory}
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

      {document.markdown ? (
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
              ? "当前分类没有导出的记忆内容。"
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
