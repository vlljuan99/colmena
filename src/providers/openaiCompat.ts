import OpenAI from "openai";
import type { ChatRequest, ChatResult, Provider } from "./types.js";
import { safeJson } from "./types.js";

interface Opts { name: string; apiKey: string; baseURL?: string; legacyMaxTokens?: boolean; supportsEffort?: boolean; sessionHeader?: string }

// Sirve para OpenAI y para cualquier API compatible (DeepSeek, OpenRouter...).
export function openaiCompat(opts: Opts): Provider {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, defaultHeaders: { "user-agent": "colmena/0.1" } });

  return {
    name: opts.name,
    async chat(req: ChatRequest): Promise<ChatResult> {
      const messages: OpenAI.ChatCompletionMessageParam[] = [];
      if (req.system) messages.push({ role: "system", content: req.system });
      for (const m of req.messages) {
        if (m.role === "assistant") {
          messages.push({
            role: "assistant",
            content: m.content || null,
            tool_calls: m.toolCalls?.length
              ? m.toolCalls.map((t) => ({ id: t.id, type: "function" as const, function: { name: t.name, arguments: JSON.stringify(t.args) } }))
              : undefined,
          });
        } else if (m.role === "tool") {
          messages.push({ role: "tool", tool_call_id: m.toolCallId ?? "", content: m.content });
        } else {
          messages.push({ role: m.role, content: m.content });
        }
      }

      const maxTokens = req.maxTokens ?? 16000;
      const res = await client.chat.completions.create({
        model: req.model,
        messages,
        ...(opts.legacyMaxTokens ? { max_tokens: maxTokens } : { max_completion_tokens: maxTokens }),
        ...(opts.supportsEffort && req.effort ? { reasoning_effort: req.effort } : {}),
        tools: req.tools?.length
          ? req.tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }))
          : undefined,
      }, opts.sessionHeader && req.sessionId ? { headers: { [opts.sessionHeader]: req.sessionId } } : undefined);

      const choice = res.choices[0];
      const toolCalls = (choice?.message.tool_calls ?? [])
        .filter((t): t is OpenAI.ChatCompletionMessageFunctionToolCall => t.type === "function")
        .map((t) => ({ id: t.id, name: t.function.name, args: safeJson(t.function.arguments) }));

      const u = res.usage as (OpenAI.CompletionUsage & { prompt_cache_hit_tokens?: number }) | undefined;
      return {
        text: choice?.message.content ?? "",
        toolCalls,
        usage: {
          input: u?.prompt_tokens ?? 0,
          output: u?.completion_tokens ?? 0,
          cacheRead: u?.prompt_cache_hit_tokens ?? u?.prompt_tokens_details?.cached_tokens ?? 0,
        },
        stopReason: choice?.finish_reason ?? "stop",
      };
    },
  };
}
