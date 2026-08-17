export type Sender = "human" | "assistant";

export interface ContentBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result" | string;
  text?: string;
  thinking?: string;
  thinking_hidden?: boolean;
  hidden?: boolean;
  hidden_in_chat?: boolean;
  truncated?: boolean;
  cut_off?: boolean;
  id?: string;
  tool_use_id?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  display_content?: unknown;
  structured_content?: unknown;
  integration_name?: string;
  is_error?: boolean;
  citations?: Citation[];
}

export interface Citation {
  uuid?: string;
  start_index?: number;
  end_index?: number;
  details?: {
    type?: string;
    url?: string;
  };
}

export interface Attachment {
  file_name?: string;
  file_size?: number;
  file_type?: string;
  extracted_content?: string;
}

export interface FileReference {
  file_name?: string;
  file_uuid?: string;
}

export interface Message {
  uuid: string;
  text?: string;
  content?: ContentBlock[];
  sender: Sender;
  created_at?: string;
  updated_at?: string;
  attachments?: Attachment[];
  files?: FileReference[];
  parent_message_uuid?: string;
}

export interface Conversation {
  uuid: string;
  account_uuid: string;
  name?: string;
  summary?: string;
  created_at?: string;
  updated_at?: string;
  chat_messages: Message[];
}

export interface Account {
  uuid: string;
  full_name?: string;
  email_address?: string;
  imported_from?: string;
}

export interface Project {
  uuid: string;
  account_uuid: string;
  name?: string;
  description?: string;
  docs?: Array<{
    uuid?: string;
    filename?: string;
    content?: string;
    created_at?: string;
  }>;
}

export interface MemoryFile {
  path: string;
  content: string;
  updated_at?: string;
}

export interface MemoryRecord {
  account_uuid: string;
  conversations_memory?: string;
  project_memories: Record<string, string>;
  memory_files?: MemoryFile[];
  imported_from?: string;
  imported_at?: string;
  source_sha256?: string;
}

export interface PinnedConversation {
  conversation_key: string;
  pinned_at: string;
}

export interface Library {
  version: number;
  imports: Array<{
    sha256: string;
    filename: string;
    imported_at: string;
    conversation_count: number;
  }>;
  accounts: Account[];
  conversations: Conversation[];
  projects: Project[];
  memories: MemoryRecord[];
  pinned_conversations: PinnedConversation[];
}

export interface HeadingEntry {
  id: string;
  level: number;
  text: string;
  fullText?: string;
  kind: "question" | "answer";
  questionNumber?: number;
  messageUuid?: string;
}

export interface HiddenItemsState {
  version: 1;
  conversationKeys: string[];
  questionIdsByConversation: Record<string, string[]>;
}

export interface ImportResult {
  canceled: boolean;
  duplicate?: boolean;
  filename?: string;
  importedConversations?: number;
  importedMemories?: number;
  library?: Library;
}

declare global {
  interface Window {
    readerAPI?: {
      importArchive(): Promise<ImportResult>;
      getLibrary(): Promise<Library>;
      clearLibrary(): Promise<{ canceled: boolean; library?: Library }>;
      copyText(text: string): Promise<boolean>;
      setConversationPinned(
        conversationKey: string,
        pinned: boolean
      ): Promise<Library>;
      getHiddenItems(): Promise<HiddenItemsState>;
      hideConversationLocally(
        accountUuid: string,
        conversationUuid: string
      ): Promise<HiddenItemsState>;
      hideQuestionLocally(
        accountUuid: string,
        conversationUuid: string,
        messageUuid: string
      ): Promise<HiddenItemsState>;
      onNavigationCommand(
        handler: (direction: "back" | "forward") => void
      ): () => void;
    };
  }
}
