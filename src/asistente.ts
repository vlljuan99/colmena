import { runAgent } from "./agent.js";
import { config } from "./config.js";
import { CostTracker } from "./cost.js";
import { SYSTEM_ENTREVISTADOR } from "./prompts.js";
import type { Msg } from "./providers/types.js";
import { getToolDefs } from "./tools.js";
import { parseJson } from "./util.js";

export interface TurnoAsistente { role: "user" | "assistant"; content: string }
export interface RespuestaAsistente { mensaje: string; objetivo: string | null; usd: number }

// Un turno de la entrevista. El cliente guarda el historial; aquí no hay estado.
export async function turnoAsistente(historial: TurnoAsistente[]): Promise<RespuestaAsistente> {
  const rol = config.roles.entrevistador;
  if (!rol) throw new Error("No hay rol entrevistador configurado.");
  const previos: Msg[] = historial.slice(0, -1).map((t) => ({ role: t.role, content: t.content }));
  const ultimo = historial[historial.length - 1];
  if (!ultimo || ultimo.role !== "user") throw new Error("El último turno debe ser del usuario.");

  const cost = new CostTracker();
  const texto = await runAgent({
    runId: "asistente", role: rol, roleLabel: "entrevistador", cost,
    system: SYSTEM_ENTREVISTADOR(),
    tools: getToolDefs().filter((t) => ["list_files", "read_file", "fetch_url"].includes(t.name)),
    maxSteps: 6, historial: previos, prompt: ultimo.content,
  });
  let mensaje = texto, objetivo: string | null = null;
  try {
    const j = parseJson<{ mensaje?: string; objetivo?: string | null }>(texto);
    mensaje = j.mensaje ?? texto;
    objetivo = j.objetivo && String(j.objetivo).trim() ? String(j.objetivo) : null;
  } catch { /* el modelo no devolvió JSON: mostramos el texto tal cual */ }
  return { mensaje, objetivo, usd: cost.totalUsd };
}
