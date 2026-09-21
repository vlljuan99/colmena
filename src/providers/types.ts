// Formato de mensajes neutral: cada proveedor lo traduce a su API.
export type MsgRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall { id: string; name: string; args: Record<string, unknown> }

export interface Msg {
  role: MsgRole;
  content: string;
  toolCalls?: ToolCall[];   // solo en assistant
  toolCallId?: string;      // solo en tool
  raw?: unknown;            // bloques originales del proveedor (p. ej. thinking de Claude) para reenviarlos intactos
  rawProvider?: string;
}

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown> }

export interface Usage { input: number; output: number; cacheRead: number }

export interface ChatRequest {
  model: string;
  system?: string;
  messages: Msg[];
  tools?: ToolDef[];
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  sessionId?: string;   // id estable de la conversación (OpenCode Go lo usa para enrutar y cachear)
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  stopReason: string;
  raw?: unknown;
}

export interface Provider {
  name: string;
  chat(req: ChatRequest): Promise<ChatResult>;
}

export function safeJson(s: string): Record<string, unknown> {
  try { const v = JSON.parse(s); return typeof v === "object" && v ? v : {}; } catch { return {}; }
}
