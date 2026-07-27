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

> 把 Claude 导出的 ZIP 变成一个可搜索、可浏览的本地会话阅读库。

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
- 接近 Claude Web 的排版、间距与消息布局
- Markdown 内容渲染
- 使用 KaTeX 渲染行内和独立 LaTeX 公式
- 代码语法高亮、语言标识与一键复制
- Claude 风格的少边框表格，以及引用、列表、链接和来源展示
- Thinking、工具调用及工具结果默认折叠，并可按组展开
- 严格遵循 `hidden` 与 `hidden_in_chat`，不显示原会话中隐藏的内容
- 只渲染当前会话分支，避免把历史分支混入正文
- 独立展示账户 Memory 与项目 Memory，并使用导出数据中的原始标题生成目录
- 在用户消息和 Claude 回复末尾还原文件预览占位卡片

### 🔍 相比 Claude Web 的阅读增强

- 全局全文搜索：同时搜索会话标题和全部消息内容
- 对话内全文搜索：显示匹配数量，可前后切换、跳转并高亮正文
- 三类独立字号调节：对话正文、左侧会话栏、右侧目录栏
- 可隐藏的对话目录：结合用户问题和 Claude 回答的主要标题生成导航
- 目录滚动跟随与一键定位，便于回看超长会话
- 左右侧栏可独立伸缩，适配不同屏幕和阅读习惯
- 支持后续重复导入，使用 SHA-256 防止同一压缩包重复写入
- 多账号导入防冲突（存储层）：会话与项目记录按账号标识保存，避免不同导出账号的数据互相覆盖；目前尚未提供账号筛选或每个账号独立资料库
  
---

## ⚠️ 重要限制：导出文件并不完整

Claude 当前的导出数据不会把用户当时上传的原始文件，以及 Claude 在回答中生成的输出文件本体一并打包。导出记录有时会保留文件名、文件引用、提取后的文本或工具调用记录，但缺失的文件本体无法由本阅读器恢复，其他应用同样无法从不存在的数据中还原它。

当导出记录中还留有足够的元数据时，阅读器会在文件原本出现的位置生成一张预览占位卡片，帮助用户保留当时对话的上下文和使用记忆。占位卡片不能打开、下载或恢复原文件；如果导出数据中包含附件提取文本，阅读器会继续显示这部分文本。

---

## 🔒 隐私与数据处理

- 只读取所选 ZIP，不会修改原始压缩包
- 导入结果仅保存在 Electron 的本地应用数据目录
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

安装依赖后，也可以双击项目根目录的 `review-windows.cmd`。

如果 Electron 安装时缺少 Chromium 二进制文件，请执行：

```powershell
npm rebuild electron
```

当前仓库提供基于源码的本地运行方式，暂未包含打包好的 Windows 安装程序。

---

## 📖 使用方法

1. 启动应用。
2. 点击“导入数据”，选择 Claude Export ZIP。
3. 从左侧栏打开需要回看的会话。
4. 使用 `Ctrl+F` 搜索当前对话，或使用 `Ctrl+Shift+F` 搜索整个本地会话库。
5. 根据需要调整主题、三类字体大小、左右侧栏和对话目录。

---

## 📄 开源协议

本项目采用 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 开源协议。你可以自由使用、修改和分发本项目代码，包括商业用途；需要保留版权声明和协议文本，修改过的文件需标注变更。本协议不授予商标使用权。
