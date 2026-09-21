import { runAgent } from "./agent.js";
import { bus } from "./bus.js";
import { config } from "./config.js";
import { CostTracker } from "./cost.js";
import { estadoRepo, repoDir } from "./git.js";
import { runActivo } from "./orchestrator.js";
import { SYSTEM_CONSULTOR } from "./prompts.js";
import type { Msg, ToolDef } from "./providers/types.js";
import { listRuns, loadRun, type Run } from "./store.js";
import { getToolDefs } from "./tools.js";

export interface TurnoConsultor { role: "user" | "assistant"; content: string }

// Chat de estado: un modelo barato responde preguntas sobre lo que ha hecho y está haciendo la colmena.
// Recibe un resumen compacto del estado y puede pedir el detalle de una ejecución o leer archivos del workspace.

const recorta = (s: string | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

function resumenRun(r: Run): string {
  const tareas = r.tareas.map((t) => "    - " + t.id + " [" + t.estado + (t.intentos > 1 ? " · " + t.intentos + " intentos" : "") + "] " + recorta(t.titulo, 90)).join("\n");
  const git = r.git ? " · git: rama " + r.git.rama + ", " + r.git.commits.length + " commits" + (r.git.pr ? ", PR " + r.git.pr : "") : "";
  return "- " + r.id + " · " + r.estado + " · $" + r.costeUsd.toFixed(3) + " · " + r.inicio.slice(0, 16).replace("T", " ") + git +
    (r.error ? "\n    error: " + recorta(r.error, 200) : "") +
    "\n    objetivo: " + recorta(r.objetivo, 220) +
    (tareas ? "\n" + tareas : "") +
    (r.informeFinal ? "\n    informe final: " + recorta(r.informeFinal, 400) : "");
}

async function contexto(): Promise<string> {
  const runs = listRuns();
  const mes = new Date().toISOString().slice(0, 7);
  const mesUsd = runs.filter((r) => r.inicio.startsWith(mes)).reduce((a, r) => a + (r.costeUsd || 0), 0);
  const activo = runActivo();
  const dir = repoDir();
  const repo = dir ? await estadoRepo(dir) : null;
  const eventos = bus.ultimos.slice(-40).map((e) => e.ts.slice(11, 19) + " [" + e.type + "] " + recorta(e.msg, 160)).join("\n");
  return [
    "FECHA Y HORA: " + new Date().toISOString(),
    "CONFIGURACIÓN: " + Object.entries(config.roles).map(([r, c]) => r + "=" + c.provider + "/" + c.model).join(", ") +
      " · tope por objetivo $" + config.limites.maxCosteUsdPorObjetivo + " · paralelos " + config.limites.ejecutoresParalelos +
      " · revisión IA " + (config.revision.activo ? "sí" : "no") + " · tests obligatorios " + (config.pruebas.obligatorias ? "sí" : "no") +
      " · git " + (config.git.activo ? "sí (push " + (config.git.push ? "sí" : "no") + ", PR " + (config.git.pullRequest ? "sí" : "no") + ")" : "no"),
    "GASTO ESTE MES: $" + mesUsd.toFixed(2) + " en " + runs.filter((r) => r.inicio.startsWith(mes)).length + " ejecuciones",
    "REPOSITORIO ACTIVO: " + (repo ? repo.carpeta + (repo.remoto ? " (" + repo.remoto + ")" : "") + ", rama " + repo.rama + ", " + repo.cambios + " cambios sin commit, ramas colmena: " + repo.ramasColmena.join(", ") : "ninguno"),
    "EJECUCIÓN EN CURSO: " + (activo ? "\n" + resumenRun(activo) : "ninguna"),
    "ÚLTIMAS EJECUCIONES (más reciente primero):\n" + (runs.slice(0, 8).map(resumenRun).join("\n") || "ninguna"),
    "ÚLTIMOS EVENTOS DEL REGISTRO:\n" + (eventos || "ninguno"),
  ].join("\n\n");
}

const HERRAMIENTAS_EXTRA: ToolDef[] = [
  {
    name: "detalle_ejecucion",
    description: "Devuelve el detalle completo de una ejecución (informes del ejecutor, comentarios del revisor, tests, git) por su id.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
];

function detalleEjecucion(id: string): string {
  const r = loadRun(id) ?? (runActivo()?.id === id ? runActivo() : undefined);
  if (!r) return "No existe la ejecución " + id;
  return JSON.stringify({
    id: r.id, estado: r.estado, objetivo: r.objetivo.slice(0, 3000), resumenPlan: r.resumenPlan, error: r.error, costeUsd: r.costeUsd, porModelo: r.porModelo, git: r.git,
    pruebas: r.pruebas ? { ok: r.pruebas.ok, resumen: r.pruebas.resumen.slice(0, 1500) } : undefined,
    tareas: r.tareas.map((t) => ({ ...t, informe: (t.informe ?? "").slice(0, 2500), revision: (t.revision ?? "").slice(0, 1200) })),
    informeFinal: (r.informeFinal ?? "").slice(0, 4000),
  }, null, 1);
}

export async function turnoConsultor(historial: TurnoConsultor[]): Promise<{ mensaje: string; usd: number }> {
  const rol = config.roles.consultor;
  const previos: Msg[] = historial.slice(0, -1).map((t) => ({ role: t.role, content: t.content }));
  const ultimo = historial[historial.length - 1];
  if (!ultimo || ultimo.role !== "user") throw new Error("El último turno debe ser del usuario.");
  const cost = new CostTracker();
  // El estado va en el mensaje del usuario (cambia cada vez); el system prompt se mantiene estable y cacheable.
  const prompt = "ESTADO ACTUAL DE COLMENA:\n" + (await contexto()) + "\n\nPREGUNTA DEL USUARIO:\n" + ultimo.content;
  const mensaje = await runAgent({
    runId: "consultor", role: rol, roleLabel: "consultor", cost,
    system: SYSTEM_CONSULTOR(),
    tools: [...HERRAMIENTAS_EXTRA, ...getToolDefs().filter((t) => t.name === "list_files" || t.name === "read_file")],
    ejecutarTool: async (name, args) => (name === "detalle_ejecucion" ? detalleEjecucion(String(args.id ?? "")) : undefined),
    maxSteps: 6, historial: previos, prompt,
  });
  return { mensaje, usd: cost.totalUsd };
}
