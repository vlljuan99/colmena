import { randomUUID } from "node:crypto";
import { bus } from "./bus.js";
import type { RoleConfig } from "./config.js";
import { config } from "./config.js";
import type { CostTracker } from "./cost.js";
import { getProvider } from "./providers/index.js";
import type { Msg, Provider, ToolDef } from "./providers/types.js";
import { runTool } from "./tools.js";

export interface AgentRun {
  runId: string;
  role: RoleConfig;
  roleLabel: string;
  taskId?: string;
  system: string;
  prompt: string;
  historial?: Msg[];   // turnos previos (user/assistant) para conversaciones; el prompt es el último mensaje del usuario
  tools?: ToolDef[];
  maxSteps?: number;
  cost: CostTracker;
  shouldStop?: () => boolean;
}

export class PresupuestoAgotado extends Error {
  constructor(public gastado: number, public tope: number) { super("Presupuesto agotado: $" + gastado.toFixed(2) + " de $" + tope + " por objetivo (súbelo en ⚙ → Límites y pulsa Continuar)."); }
}

const RESULTADOS_RECIENTES = 4;   // resultados de herramienta que se conservan íntegros al compactar
const estimarTokens = (msgs: Msg[]) => Math.round(msgs.reduce((n, m) => n + m.content.length + JSON.stringify(m.toolCalls ?? []).length, 0) / 4);

// Bucle agéntico genérico: llama al modelo, ejecuta herramientas, repite hasta que responde sin herramientas.
export async function runAgent(a: AgentRun): Promise<string> {
  const provider = getProvider(a.role.provider);
  let messages: Msg[] = [...(a.historial ?? []), { role: "user", content: a.prompt }];
  const maxSteps = a.maxSteps ?? config.limites.maxPasosPorTarea;
  const sessionId = a.runId + "-" + a.roleLabel + "-" + randomUUID().slice(0, 8);

  for (let step = 1; step <= maxSteps; step++) {
    if (a.shouldStop?.()) return "[detenido por el usuario]";

    const res = await provider.chat({ model: a.role.model, system: a.system, messages, tools: a.tools, effort: a.role.effort, sessionId });
    const usd = a.cost.add(a.role.model, res.usage);
    const cliff = config.precios[a.role.model]?.cliff;
    if (cliff && res.usage.input > cliff.inputTokens) {
      bus.emitEvent(a.runId, "log", "⚠ " + a.role.model + ": " + res.usage.input + " tokens de entrada superan el precipicio de " + cliff.inputTokens + " → toda la llamada se cobra a $" + cliff.input + "/M");
    }
    bus.emitEvent(a.runId, "agent.call",
      a.roleLabel + " · " + a.role.model + " · " + res.usage.input + "→" + res.usage.output + " tokens" + (res.usage.cacheRead ? " (" + res.usage.cacheRead + " en caché)" : "") + " · $" + usd.toFixed(4),
      { role: a.roleLabel, model: a.role.model, usage: res.usage, usd, totalUsd: a.cost.totalUsd, step, taskId: a.taskId });

    if (a.cost.totalUsd > config.limites.maxCosteUsdPorObjetivo) {
      throw new PresupuestoAgotado(a.cost.totalUsd, config.limites.maxCosteUsdPorObjetivo);
    }

    messages.push({ role: "assistant", content: res.text, toolCalls: res.toolCalls, raw: res.raw, rawProvider: provider.name });

    if (!res.toolCalls.length) return res.text;

    for (const call of res.toolCalls) {
      const preview = JSON.stringify(call.args).slice(0, 200);
      bus.emitEvent(a.runId, "agent.tool", a.roleLabel + " → " + call.name + " " + preview, { role: a.roleLabel, tool: call.name, args: call.args, taskId: a.taskId });
      const result = await runTool(call.name, call.args);
      messages.push({ role: "tool", content: result, toolCallId: call.id });
    }

    // Compactación: si la última llamada ya iba cargada, reducimos el contexto antes de la siguiente.
    if (res.usage.input > config.limites.compactarTokens) {
      messages = await compactar(a, provider, messages, sessionId, res.usage.input);
    }
  }
  return "[el " + a.roleLabel + " agotó los " + maxSteps + " pasos sin terminar]";
}

// Dos niveles, como el context editing + compaction de Claude pero neutral al proveedor:
//  1) vaciar resultados antiguos de herramientas (gratis, suele bastar);
//  2) si sigue grande, pedir al propio modelo un resumen del progreso y seguir desde ahí.
async function compactar(a: AgentRun, provider: Provider, messages: Msg[], sessionId: string, tokensAntes: number): Promise<Msg[]> {
  const prompt = messages[0];
  const toolIdx = messages.map((m, i) => (m.role === "tool" ? i : -1)).filter((i) => i >= 0);
  for (const i of toolIdx.slice(0, Math.max(0, toolIdx.length - RESULTADOS_RECIENTES))) {
    if (messages[i].content.length > 200) messages[i] = { ...messages[i], content: "[resultado antiguo omitido al compactar: " + messages[i].content.slice(0, 120).replaceAll("\n", " ") + "…]" };
  }
  let nivel = "resultados antiguos vaciados";
  let despues = estimarTokens(messages);

  if (despues > config.limites.compactarTokens * 0.7) {
    const transcripcion = messages.slice(1).map((m) =>
      m.role === "assistant" ? "ASISTENTE: " + (m.content || "") + (m.toolCalls?.length ? "\n[llamó a " + m.toolCalls.map((t) => t.name + " " + JSON.stringify(t.args).slice(0, 150)).join("; ") + "]" : "")
      : m.role === "tool" ? "RESULTADO: " + m.content.slice(0, 1500)
      : "USUARIO: " + m.content).join("\n\n");
    const res = await provider.chat({
      model: a.role.model, effort: "low", sessionId,
      system: "Resumes el progreso de un agente para que pueda continuar con menos contexto. Responde solo con el resumen.",
      messages: [{ role: "user", content:
        "TAREA ORIGINAL:\n" + prompt.content + "\n\nTRANSCRIPCIÓN HASTA AHORA:\n" + transcripcion +
        "\n\nEscribe un resumen compacto (máx. 600 palabras) con: qué se ha hecho, archivos creados/modificados y su estado, decisiones tomadas, errores encontrados y cómo se resolvieron, y qué falta exactamente por hacer." }],
    });
    a.cost.add(a.role.model, res.usage);
    messages = [prompt, { role: "user", content: "CONTEXTO COMPACTADO (resumen de tu propio trabajo previo; los mensajes anteriores se han eliminado):\n" + res.text + "\n\nContinúa la tarea desde aquí. Vuelve a leer los archivos que necesites." }];
    nivel = "resumen del progreso";
    despues = estimarTokens(messages);
  }
  bus.emitEvent(a.runId, "agent.compact", a.roleLabel + " · contexto compactado (" + nivel + "): ~" + tokensAntes + " → ~" + despues + " tokens", { role: a.roleLabel, antes: tokensAntes, despues, nivel });
  return messages;
}
