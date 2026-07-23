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
              type: "text",
              text:
                "# 总体方案\n\n阅读器会完全在本地处理导出文件，不上传聊天记录。\n\n" +
                "## 数据导入\n\n每次导入都会计算文件指纹，并以账户和消息 UUID 去重。\n\n" +
                "### 安全边界\n\n原始 ZIP 保持只读，本地修订与手动分类单独保存。\n\n" +
                "## 阅读体验\n\n正文支持 Markdown、代码、引用和工具卡片。\n\n" +
                "```ts\nconst archive = await importArchive(filePath);\n```\n\n" +
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
            }
          ],
          files: [
            {
              file_uuid: "demo-pdf",
              file_name: "project-document.pdf"
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
