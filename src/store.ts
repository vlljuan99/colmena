import fs from "node:fs";
import path from "node:path";
import { HOME } from "./config.js";
import type { ModelTotals } from "./cost.js";

export type TaskStatus = "pendiente" | "en_curso" | "revisando" | "hecha" | "fallida";
export type RunStatus = "planificando" | "ejecutando" | "terminada" | "error" | "detenida";

// Los cinco "equipos" de obreras de la infografía: cada tarea pertenece a uno.
export type Categoria = "codigo" | "investigacion" | "escritura" | "datos" | "monitorizacion";
export const CATEGORIAS: Categoria[] = ["codigo", "investigacion", "escritura", "datos", "monitorizacion"];

export interface Task {
  id: string;
  titulo: string;
  categoria: Categoria;
  instrucciones: string;
  entregable: string;
  depende_de: string[];
  estado: TaskStatus;
  intentos: number;
  obrera?: number;   // índice del agente que la ejecuta (para pintarlo en el esquema)
  informe?: string;
  revision?: string;
}

export interface Run {
  id: string;
  objetivo: string;
  origen: "web" | "cli" | "cron";
  estado: RunStatus;
  inicio: string;
  fin?: string;
  resumenPlan?: string;
  tareas: Task[];
  informeFinal?: string;
  error?: string;
  pruebas?: { ok: boolean; resumen: string };                 // último resultado de tests del objetivo
  git?: { dir: string; rama: string; base: string; commits: string[]; pr?: string; error?: string };
  costeUsd: number;
  porModelo: Record<string, ModelTotals>;
}

const DIR = path.join(HOME, "data", "runs");
fs.mkdirSync(DIR, { recursive: true });

export function saveRun(run: Run) {
  fs.writeFileSync(path.join(DIR, run.id + ".json"), JSON.stringify(run, null, 2), "utf8");
}

export function loadRun(id: string): Run | undefined {
  const f = path.join(DIR, id.replace(/[^a-z0-9-]/gi, "") + ".json");
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as Run) : undefined;
}

export function listRuns(): Run[] {
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as Run)
    .sort((a, b) => b.inicio.localeCompare(a.inicio));
}
