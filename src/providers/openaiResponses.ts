import OpenAI from "openai";
import type { ChatRequest, ChatResult, Provider } from "./types.js";
import { safeJson } from "./types.js";

// OpenAI vía la API Responses: es la única que admite reasoning_effort junto con herramientas en GPT-6 Astra.
// Los items de salida (incluido el razonamiento) se guardan en Msg.raw y se reenvían intactos en el siguiente turno.
export function openaiResponses(apiKey: string): Provider {
  const client = new OpenAI({ apiKey, defaultHeaders: { "user-agent": "colmena/0.1" } });

  return {
    name: "openai",
    async chat(req: ChatRequest): Promise<ChatResult> {
      const input: OpenAI.Responses.ResponseInputItem[] = [];
      for (const m of req.messages) {
        if (m.role === "system") continue;
        if (m.role === "assistant") {
          if (m.rawProvider === "openai" && Array.isArray(m.raw)) {
            input.push(...(m.raw as OpenAI.Responses.ResponseInputItem[]));
            continue;
          }
          if (m.content.trim()) input.push({ role: "assistant", content: m.content });
          for (const t of m.toolCalls ?? []) input.push({ type: "function_call", call_id: t.id, name: t.name, arguments: JSON.stringify(t.args) });
        } else if (m.role === "tool") {
          input.push({ type: "function_call_output", call_id: m.toolCallId ?? "", output: m.content });
        } else {
          input.push({ role: "user", content: m.content });
        }
      }

      const res = await client.responses.create({
        model: req.model,
        instructions: req.system,
        input,
        max_output_tokens: req.maxTokens ?? 16000,
        ...(req.effort ? { reasoning: { effort: req.effort as OpenAI.ReasoningEffort } } : {}),
        tools: req.tools?.length
          ? req.tools.map((t) => ({ type: "function" as const, name: t.name, description: t.description, parameters: t.parameters, strict: false }))
          : undefined,
        store: false,
        include: ["reasoning.encrypted_content"],
      });

      const text = res.output_text ?? "";
      const toolCalls = res.output
        .filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === "function_call")
        .map((o) => ({ id: o.call_id, name: o.name, args: safeJson(o.arguments) }));

      return {
        text,
        toolCalls,
        usage: {
          input: res.usage?.input_tokens ?? 0,
          output: res.usage?.output_tokens ?? 0,
          cacheRead: res.usage?.input_tokens_details?.cached_tokens ?? 0,
        },
        stopReason: res.status ?? "completed",
        // Sin `store`, el razonamiento vuelve cifrado y hay que reenviarlo tal cual para que el modelo lo recuerde.
        raw: res.output,
      };
    },
  };
}
