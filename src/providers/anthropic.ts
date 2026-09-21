import Anthropic from "@anthropic-ai/sdk";
import type { ChatRequest, ChatResult, Provider } from "./types.js";

export function anthropicProvider(apiKey: string): Provider {
  const client = new Anthropic({ apiKey });

  return {
    name: "anthropic",
    async chat(req: ChatRequest): Promise<ChatResult> {
      const messages: Anthropic.Beta.BetaMessageParam[] = [];
      for (const m of req.messages) {
        if (m.role === "system") continue; // va en `system`
        if (m.role === "assistant") {
          // Si el turno vino de Claude, reenviamos sus bloques tal cual (conserva thinking + tool_use).
          if (m.rawProvider === "anthropic" && Array.isArray(m.raw)) {
            messages.push({ role: "assistant", content: m.raw as Anthropic.Beta.BetaContentBlockParam[] });
            continue;
          }
          const content: Anthropic.Beta.BetaContentBlockParam[] = [];
          if (m.content.trim()) content.push({ type: "text", text: m.content.trim() });
          for (const t of m.toolCalls ?? []) content.push({ type: "tool_use", id: t.id, name: t.name, input: t.args });
          if (!content.length) content.push({ type: "text", text: "(sin contenido)" });
          messages.push({ role: "assistant", content });
        } else if (m.role === "tool") {
          const block: Anthropic.Beta.BetaToolResultBlockParam = { type: "tool_result", tool_use_id: m.toolCallId ?? "", content: m.content };
          const last = messages[messages.length - 1];
          if (last && last.role === "user" && Array.isArray(last.content)) {
            (last.content as Anthropic.Beta.BetaContentBlockParam[]).push(block);
          } else {
            messages.push({ role: "user", content: [block] });
          }
        } else {
          messages.push({ role: "user", content: m.content });
        }
      }

      const res = await client.beta.messages.create({
        model: req.model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        messages,
        // Caché automática del último bloque: en bucles con herramientas cada paso reutiliza todo el historial anterior
        // (system + mensajes + resultados de herramientas) a 1/10 del precio en vez de pagarlo entero otra vez.
        cache_control: { type: "ephemeral" },
        tools: req.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema,
        })),
        thinking: { type: "adaptive" },
        ...(req.effort ? { output_config: { effort: req.effort } } : {}),
        // Si un clasificador rechaza la petición, el servidor la reintenta en un modelo alternativo.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });

      if (res.stop_reason === "refusal") {
        const why = res.stop_details?.type === "refusal" ? res.stop_details.explanation ?? "" : "";
        return { text: `[Claude rechazó la petición: ${why}]`, toolCalls: [], usage: usageOf(res), stopReason: "refusal", raw: res.content };
      }

      const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const toolCalls = res.content
        .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, args: (b.input ?? {}) as Record<string, unknown> }));

      return { text, toolCalls, usage: usageOf(res), stopReason: res.stop_reason ?? "end_turn", raw: res.content };
    },
  };
}

function usageOf(res: Anthropic.Beta.BetaMessage) {
  return {
    input: (res.usage.input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0),
    output: res.usage.output_tokens ?? 0,
    cacheRead: res.usage.cache_read_input_tokens ?? 0,
  };
}
