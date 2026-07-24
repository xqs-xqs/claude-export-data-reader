import type { Library } from "./types";

export const DEMO_LIBRARY: Library = {
  version: 1,
  imports: [
    {
      sha256: "demo",
      filename: "claude-export-demo.zip",
      imported_at: "2026-07-23T08:00:00Z",
      conversation_count: 2
    }
  ],
  accounts: [
    {
      uuid: "demo-account",
      full_name: "演示账户",
      email_address: "",
      imported_from: "claude-export-demo.zip"
    }
  ],
  projects: [],
  conversations: [
    {
      uuid: "demo-conversation",
      account_uuid: "demo-account",
      name: "Claude 导出数据阅读器实施方案",
      summary: "讨论本地归档、界面还原和增量导入方案。",
      created_at: "2026-07-20T08:00:00Z",
      updated_at: "2026-07-23T08:00:00Z",
      chat_messages: [
        {
          uuid: "demo-human",
          sender: "human",
          created_at: "2026-07-20T08:00:00Z",
          parent_message_uuid: "root",
          text: "请给出详细的本地数据阅读器方案。",
          content: [
            {
              type: "text",
              text: "请给出详细的本地数据阅读器方案，并保留原始聊天记录。"
            }
          ],
          files: [
            {
              file_uuid: "demo-file",
              file_name: "claude-export-data.zip"
            }
          ]
        },
        {
          uuid: "demo-assistant",
          sender: "assistant",
          created_at: "2026-07-20T08:00:03Z",
          parent_message_uuid: "demo-human",
          content: [
            {
              type: "thinking",
              thinking: "需要兼顾数据完整性、隐私、视觉一致性和后续重复导入。",
              thinking_hidden: false
            },
            {
              type: "thinking",
              thinking: "DEMO_HIDDEN_PROCESS_SENTINEL",
              hidden_in_chat: true
            },
            {
              type: "tool_use",
              id: "demo-analysis-tool",
              name: "inspect_schema",
              integration_name: "File Creation",
              input: {
                scope: "conversation-content"
              }
            },
            {
              type: "tool_result",
              tool_use_id: "demo-analysis-tool",
              integration_name: "File Creation",
              content: {
                status: "verified"
              }
            },
            {
              type: "thinking",
              thinking: "继续核对公式、表格和代码围栏的渲染边界。",
              thinking_hidden: false
            },
            {
              type: "text",
              text:
                "# 总体方案\n\n阅读器会完全在本地处理导出文件，不上传聊天记录。\n\n" +
                "## 数据导入\n\n每次导入都会计算文件指纹，并以账户和消息 UUID 去重。\n\n" +
                "### 安全边界\n\n原始 ZIP 保持只读，本地修订与手动分类单独保存。\n\n" +
                "## 阅读体验\n\n正文支持 Markdown、代码、引用和工具卡片。\n\n" +
                "```ts\nconst archive = await importArchive(filePath);\nconst literal = \"$x$\";\n```\n\n" +
                "行内公式 $x_i \\in \\mathbb{R}^d$、变量列表 $k, L$ 与括号公式 \\(a+b=c\\) 均在本地渲染；价格 $5–$20 和行内代码 `$x$` 保持原文。\n\n" +
                "查询文本 {'$and': [{'course_code': {'$eq': 'CS'}}]} 不应被识别为公式。\n\n" +
                ">     $x$ 位于引用内的缩进代码中，也保持代码文本。\n\n" +
                "$$\\mathcal{N}_k(q)=\\{x_1^q,\\ldots,x_k^q\\}\\subseteq\\mathbf{X}$$\n\n" +
                "| 数据 | 说明 |\n| :--- | ---: |\n| 邻接矩阵 | $A \\in \\{0,1\\}^{|V| \\times |V|}$ |\n| 查询复杂度 | $O(n \\log n)$ |\n\n" +
                "**阶段 5：补充检查**\n\n独立粗体标题也会出现在右侧目录中。\n\n" +
                "## 后续导入\n\n新导出包可以继续添加，不会覆盖已经保存的原始版本。"
            },
            {
              type: "tool_use",
              id: "demo-tool",
              name: "inspect_archive",
              integration_name: "File Creation",
              input: {
                archive: "claude-export-data.zip",
                mode: "read-only"
              }
            },
            {
              type: "tool_result",
              tool_use_id: "demo-tool",
              integration_name: "File Creation",
              content: {
                conversations: 107,
                status: "verified"
              }
            },
            {
              type: "tool_use",
              id: "demo-present-files",
              name: "present_files",
              input: {
                filepaths: ["/mnt/user-data/outputs/reader-report.docx"]
              }
            },
            {
              type: "tool_result",
              tool_use_id: "demo-present-files",
              name: "present_files",
              content: [
                {
                  type: "local_resource",
                  file_path: "/mnt/user-data/outputs/reader-report.docx",
                  name: "reader report",
                  mime_type:
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  uuid: "demo-generated-docx"
                }
              ]
            },
            {
              type: "tool_use",
              id: "demo-hidden-present-files",
              name: "present_files",
              hidden_in_chat: true,
              input: {
                filepaths: ["/mnt/user-data/outputs/private-draft.zip"]
              }
            },
            {
              type: "tool_result",
              tool_use_id: "demo-hidden-present-files",
              name: "present_files",
              hidden_in_chat: true,
              content: [
                {
                  type: "local_resource",
                  file_path: "/mnt/user-data/outputs/private-draft.zip",
                  name: "private draft",
                  mime_type: "application/zip",
                  uuid: "demo-hidden-generated-file"
                }
              ]
            }
          ],
          files: [
            {
              file_uuid: "demo-pdf",
              file_name: "project-document.pdf"
            }
          ]
        },
        {
          uuid: "demo-human-followup",
          sender: "human",
          created_at: "2026-07-23T08:04:00Z",
          parent_message_uuid: "demo-assistant",
          text:
            "右侧导航怎样区分每一轮问题与回答？左右侧栏能否调整宽度？",
          content: [
            {
              type: "text",
              text:
                "1. 右侧导航怎样区分每一轮问题与回答，并避免子标题过多？\n" +
                "2. 左右侧栏能否根据阅读习惯调整宽度？"
            }
          ]
        },
        {
          uuid: "demo-assistant-followup",
          sender: "assistant",
          created_at: "2026-07-23T08:04:03Z",
          parent_message_uuid: "demo-human-followup",
          content: [
            {
              type: "text",
              text:
                "## 对话分组\n\n问题作为一级入口，只展开当前一轮的回答标题。\n\n" +
                "### 内部实现细节\n\n这个三级标题不会进入右侧导航。\n\n" +
                "## 侧栏伸缩\n\n拖动左右分隔线即可调整宽度，设置会保存在本机。"
            }
          ]
        }
      ]
    },
    {
      uuid: "demo-second",
      account_uuid: "demo-account",
      name: "附件与项目数据检查",
      summary: "演示第二条聊天。",
      created_at: "2026-07-18T08:00:00Z",
      updated_at: "2026-07-18T09:00:00Z",
      chat_messages: []
    }
  ]
};
