<h1 align="center">Claude 导出数据阅读器</h1>

<p align="center">
  <a href="https://www.apache.org/licenses/LICENSE-2.0"><img alt="Apache License 2.0" src="https://img.shields.io/badge/License-Apache%202.0-D22128?logo=apache&logoColor=white"></a>
  <img alt="Windows 10+" src="https://img.shields.io/badge/Platform-Windows%2010%2B-0078D4?logo=windows11&logoColor=white">
  <a href="https://www.electronjs.org/"><img alt="Electron 43" src="https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white"></a>
  <a href="https://react.dev/"><img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=20232A"></a>
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript 5" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white"></a>
  <img alt="Local-only data" src="https://img.shields.io/badge/Data-Local--only-CB6D51">
</p>

<div align="center">

> 把 Claude 导出的旧版单 ZIP 或新版四类分包 ZIP 变成一个可搜索、可浏览的本地会话阅读库。

只读桌面应用，用于回看 Claude 导出的历史会话，适配 Claude Web 视觉语言，还原原生阅读体验。

</div>




<p align="center">
  <strong>简体中文</strong> | <a href="./README_EN.md">English</a>
</p>



---

## ✨ 现有功能

### 🎨 Claude 风格阅读体验

- 桌面端三栏布局，左右侧栏均可隐藏和拖动调整宽度
- 浅色与深色主题
- 接近 Claude Web 的阅读背景、字体、正文宽度、间距与消息布局
- 顶部栏显示当前会话标题，长用户问题自动折叠，可通过 `Show more / Show less` 展开或收起
- Markdown 内容渲染，包括标题、列表、分割线、链接、引用与表格
- 使用 KaTeX 渲染行内和独立 LaTeX 公式
- Claude 风格代码块：语法高亮、一键复制，已声明语言时显示标题行，未声明语言时保持简洁样式
- Claude 风格的少边框表格与对称分割线；来源按导出位置显示内联编号与本地 URL 浮层
- Thinking、工具调用及工具结果默认折叠，并可按组展开
- 严格遵循 `hidden` 与 `hidden_in_chat`，不显示原会话中隐藏的内容
- 只渲染当前会话分支，避免把历史分支混入正文
- 兼容旧版账户 Memory、项目 Memory 与新版 `memory_files` 结构化记忆导出
- 新版 Memory 按 You、Topics、Areas 和 People 分类，提供列表、详情与目录导航，不直接暴露底层 YAML 元数据
- 在用户消息和 Claude 回复末尾还原文件预览占位卡片

### 🔍 相比 Claude Web 的阅读增强

- 全局全文搜索：同时搜索会话标题和全部消息内容
- 对话内全文搜索：显示匹配数量，可前后切换、跳转并高亮正文
- 收藏并置顶会话：收藏内容独立显示在 `Pinned` 分区，并保存在阅读器本地
- 三类独立字号调节：对话正文、左侧会话栏、右侧目录栏
- 可隐藏的对话目录：结合用户问题和 Claude 回答的主要标题生成导航
- 目录滚动跟随与一键定位，便于回看超长会话
- 本地隐藏：可从会话列表隐藏整个对话，也可从问题气泡或目录隐藏一个问题及其对应回答
- 阅读历史前进/后退：支持顶部按钮、`Alt+← / Alt+→`，Windows 下可直接使用鼠标侧键
- 重新打开应用时恢复上次账户、会话或 Memory 页面、侧栏状态和阅读位置
- 左右侧栏可独立伸缩，适配不同屏幕和阅读习惯
- 兼容旧版单 ZIP，以及新版 `light_metadata`、`projects`、`memories`、`conversations` 四类分包 ZIP；同类别多 part 会按编号合并
- 支持后续重复导入，使用 SHA-256 防止同一导出批次重复写入
- 多账号切换与严格数据隔离：会话、搜索结果、Pinned 和 Memory 均只显示当前账号的内容
  
---

## ⚠️ 重要限制：导出文件并不完整

Claude 当前的导出数据不会把用户当时上传的原始文件，以及 Claude 在回答中生成的输出文件本体一并打包。导出记录有时会保留文件名、文件引用、提取后的文本或工具调用记录，但缺失的文件本体无法由本阅读器恢复，其他应用同样无法从不存在的数据中还原它。

当导出记录中还留有足够的元数据时，阅读器会在文件原本出现的位置生成一张预览占位卡片，帮助用户保留当时对话的上下文和使用记忆。占位卡片不能打开、下载或恢复原文件；如果导出数据中包含附件提取文本，阅读器会继续显示这部分文本。

---

## 🔒 隐私与数据处理

- 只读取用户主动选择的 ZIP，不会修改原始文件，也不会自动下载其他内容
- 新版 `light_metadata` 中的登录历史不会被解析或保存
- 导入结果仅保存在 Electron 的本地应用数据目录
- “删除”只是在本机阅读界面中持久隐藏，不修改原 ZIP 或已导入的聊天正文，也不等同于安全擦除；应用内不提供恢复入口
- 不上传聊天数据，不需要 Claude 账号或 API Key
- 正式版会阻止导出内容主动访问网络；HTTP/HTTPS 外链只会交给系统浏览器打开
- 可以以后继续导入其他 Claude 导出包，重复数据会在合并前检测
- 导出 ZIP、本地数据库、日志和密钥默认不会提交到 Git
- 当前资料以明文 JSON 保存，依赖 Windows 用户账户与设备权限保护；请勿在不受信任或多人共用的系统账户中导入敏感归档

---

## 🖥️ 在 Windows 上安装和运行

环境要求：

- Windows 10 或更高版本
- Node.js 22.12 或更高版本
- npm

安装依赖并启动开发版本：

```powershell
npm install
npm run dev
```

构建并启动本地桌面版本：

```powershell
npm run build
npm start
```

安装依赖后，也可以双击项目根目录的 `review-windows.cmd`。该脚本会在首次启动或前端源码、构建配置发生变化时自动构建；其余启动直接复用现有构建，避免重复等待。


如果 Electron 安装时缺少 Chromium 二进制文件，请执行：

```powershell
npm rebuild electron
```

当前仓库提供基于源码的本地运行方式，暂未包含打包好的 Windows 安装程序。

---

## 📖 使用方法

1. 启动应用。
2. 点击“导入数据”。旧版导出请选择一个 Claude Export ZIP；新版导出请在同一个文件选择窗口中一次性多选 `light_metadata-000.zip`、`projects-000.zip`、`memories-000.zip` 和 `conversations-000.zip`。
   若某一类包含 `001`、`002` 等后续分包，也需要同时选中；选择顺序不限。阅读器会先验证四类文件、分包编号与账户归属，全部通过后才写入本地数据。
3. 导入多个账号时，使用左下角账号菜单切换当前账号。
4. 从左侧栏打开需要回看的会话，或进入 Memory 查看导出的账户与项目记忆。
5. 使用 `Ctrl+F` 搜索当前对话，或使用 `Ctrl+Shift+F` 搜索当前账号的本地会话库。
6. 使用顶部按钮、`Alt+← / Alt+→` 或 Windows 鼠标侧键在最近访问的位置间前进、后退。
7. 根据需要调整主题、三类字体大小、左右侧栏和对话目录。

---

## 📄 开源协议

本项目采用 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 开源协议。你可以自由使用、修改和分发本项目代码，包括商业用途；需要保留版权声明和协议文本，修改过的文件需标注变更。本协议不授予商标使用权。
