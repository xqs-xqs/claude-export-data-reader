# Claude Export Data Reader

> Can't access chats from a suspended Claude account? Claude Export Data Reader lets you privately import and browse exported conversation archives on your desktop.

Claude Export Data Reader is a local, read-only desktop application for importing Claude data-export ZIP files and restoring their conversations in a polished, familiar reading interface. It is designed for people who still have their exported data but can no longer access the original account.

The application keeps archives on your computer, supports repeated imports and multiple accounts, and is being built to render conversation branches, Markdown, code, thinking sections, tool activity, citations, projects, and attachment placeholders. It is not affiliated with or endorsed by Anthropic.

## Features

- Local-only, read-only archive browsing
- Repeated ZIP imports with SHA-256 duplicate detection
- Multiple exported accounts
- Light and dark themes
- Collapsible left conversation sidebar
- Collapsible right heading outline with scroll tracking
- Current-branch conversation rendering
- Markdown, code, thinking, tool, citation, and file-card rendering
- No upload, cloud account, or API key required

## Install and run

Requirements:

- Windows 10 or later
- Node.js 20 or later
- npm

Development:

```bash
npm install
npm run dev
```

Build the web assets:

```bash
npm run build
```

A packaged Windows installer will be added after the import and rendering workflows are validated against real exports.

## Use

1. Launch the application.
2. Click **Import archive**.
3. Select an original Claude data-export ZIP.
4. Wait for the local import to finish.
5. Select an account and conversation from the left sidebar.
6. Use the right outline to jump between headings.
7. Switch light or dark mode from the toolbar.

The original ZIP is opened read-only. Imported data is stored only in the application's local data directory. Export archives, local databases, and secrets are excluded from Git by default.

---

# Claude 导出数据阅读器

> Claude 账号被封以后看不了以前的聊天记录？可以使用 Claude 导出数据阅读器，在本地导入并浏览已经导出的会话数据。

Claude 导出数据阅读器是一款纯本地、只读的桌面应用。它可以导入 Claude 数据导出 ZIP，并以熟悉、精致的聊天阅读界面还原历史会话，适合仍持有导出数据、但已经无法登录原账号的用户。

应用不会上传聊天数据，支持重复导入和多个账号，并将逐步完整呈现会话分支、Markdown、代码、Thinking、工具调用、引用来源、项目和附件占位预览。本项目与 Anthropic 没有隶属、合作或官方认可关系。

## 功能

- 纯本地、只读浏览
- 使用 SHA-256 检测重复导入
- 支持多个导出账号
- 浅色与深色主题
- 可隐藏的左侧会话栏
- 可隐藏的右侧标题导航及滚动高亮
- 只展示当前会话分支
- 渲染 Markdown、代码、Thinking、工具、引用和文件卡片
- 无需云端账号或 API Key

## 安装与运行

环境要求：

- Windows 10 或更高版本
- Node.js 20 或更高版本
- npm

开发运行：

```bash
npm install
npm run dev
```

构建前端资源：

```bash
npm run build
```

在真实导出数据完成导入和渲染验证后，项目会增加可直接安装的 Windows 安装包。

## 使用方法

1. 启动应用。
2. 点击“导入数据”。
3. 选择原始 Claude 数据导出 ZIP。
4. 等待本地导入完成。
5. 从左侧栏选择账号和会话。
6. 使用右侧标题导航快速跳转。
7. 在工具栏切换浅色或深色主题。

应用仅以只读方式打开原始 ZIP。导入内容只会保存在应用的本地数据目录中。导出 ZIP、本地数据库和密钥默认不会进入 Git。
