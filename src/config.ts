import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ProviderName = "openai" | "deepseek" | "anthropic" | "opencode" | "mock";
export type RoleName = "planificador" | "ejecutor" | "revisor" | "entrevistador" | "consultor";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// effort: esfuerzo de razonamiento (OpenAI reasoning_effort / Claude output_config.effort). El hilo recomienda "low" para Astra en el día a día.
export interface RoleConfig { provider: ProviderName; model: string; effort?: Effort }

export interface PriceEntry {
  input: number; output: number; cacheRead: number;
  offPeak?: { input: number; output: number; cacheRead: number };
  peakHoursUTC?: [number, number][];
  peakDaysUTC?: number[];                                   // 0=domingo … 6=sábado; si falta, todos los días
  // Precipicio: si la entrada supera inputTokens, TODA la petición se cobra a estas tarifas (GPT-6 Astra > 272K).
  cliff?: { inputTokens: number; input: number; output: number; cacheRead?: number };
}

// modo "objetivo": plan → ejecutar → revisar (usa Astra). modo "latido": va directo al ejecutor barato, sin planificar ni revisar.
export interface CronEntry { nombre: string; activo: boolean; expresion: string; objetivo: string; modo?: "objetivo" | "latido" }

export interface Config {
  workspace: string;
  roles: Record<RoleName, RoleConfig>;
  limites: {
    maxTareasPorObjetivo: number;
    maxPasosPorTarea: number;
    maxReintentosPorTarea: number;
    maxCosteUsdPorObjetivo: number;
    timeoutComandoSeg: number;
    compactarTokens: number;   // si una llamada supera estos tokens de entrada, se compacta el contexto antes de la siguiente
    ejecutoresParalelos: number; // tareas independientes que se ejecutan a la vez (cada una es una "obrera")
  };
  precios: Record<string, PriceEntry>;
  cron: CronEntry[];
  asistente: { activo: boolean };   // entrevista previa para pulir el objetivo (rol entrevistador)
  // Pruebas obligatorias: tras cada tarea se ejecutan los tests del proyecto; si fallan, la tarea vuelve al ejecutor.
  pruebas: { obligatorias: boolean; comando: string; timeoutSeg: number };
  // Revisión por IA tras los tests. Desactivada, una tarea se aprueba en cuanto pasan los tests (o si no hay).
  revision: { activo: boolean };
  // Git determinista por objetivo: rama, commit por tarea aprobada, y opcionalmente push + pull request en GitHub.
  git: { activo: boolean; ramaPorObjetivo: boolean; commitPorTarea: boolean; push: boolean; pullRequest: boolean; repo?: string };
}

// Carpeta del código (dist/ o src/) → raíz del paquete, donde viven public/ y la config por defecto.
export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// HOME: donde se guardan config, claves, historial y workspace.
// En desarrollo es la carpeta del proyecto; empaquetado como app, Electron pasa COLMENA_HOME (%APPDATA%\Colmena).
export const HOME = process.env.COLMENA_HOME ? path.resolve(process.env.COLMENA_HOME) : PKG_ROOT;
fs.mkdirSync(HOME, { recursive: true });

export const CONFIG_FILE = path.join(HOME, "colmena.config.json");
export const ENV_FILE = path.join(HOME, ".env");

export const KEY_VARS = ["OPENAI_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "OPENCODE_API_KEY", "GITHUB_TOKEN"] as const;
export type KeyVar = (typeof KEY_VARS)[number];

// ---------- claves (.env) ----------

function parseEnv(txt: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(ENV_FILE, "utf8")))) {
    if (v) process.env[k] = v;
  }
}

// Guarda claves en .env (solo las que vengan con valor; null borra). Actualiza process.env al momento.
export function saveKeys(cambios: Partial<Record<KeyVar, string | null>>) {
  const actual = fs.existsSync(ENV_FILE) ? parseEnv(fs.readFileSync(ENV_FILE, "utf8")) : {};
  for (const k of KEY_VARS) {
    const v = cambios[k];
    if (v === undefined || v === "") continue;
    if (v === null) { delete actual[k]; delete process.env[k]; }
    else { actual[k] = v.trim(); process.env[k] = v.trim(); }
  }
  const lineas = ["# Claves API de Colmena (editable desde el panel ⚙ Configuración)", ...Object.entries(actual).map(([k, v]) => k + "=" + v), ""];
  fs.writeFileSync(ENV_FILE, lineas.join("\n"), "utf8");
}

export function keyStatus(): Record<KeyVar, boolean> {
  return Object.fromEntries(KEY_VARS.map((k) => [k, !!process.env[k]])) as Record<KeyVar, boolean>;
}

// ---------- config ----------

function readConfigFile(): Config {
  if (!fs.existsSync(CONFIG_FILE)) {
    // Primera ejecución de la app empaquetada: copiamos la config por defecto del paquete.
    fs.copyFileSync(path.join(PKG_ROOT, "colmena.config.json"), CONFIG_FILE);
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as Config;
  cfg.cron ??= [];
  cfg.precios ??= {};
  cfg.limites.compactarTokens ??= 120000;
  cfg.limites.ejecutoresParalelos ??= 2;
  cfg.roles.entrevistador ??= { provider: "anthropic", model: "claude-sonnet-5", effort: "medium" };
  cfg.roles.consultor ??= { provider: "deepseek", model: "deepseek-flash" };   // chat de estado: barato
  cfg.asistente ??= { activo: true };
  cfg.pruebas = { ...{ obligatorias: true, comando: "", timeoutSeg: 300 }, ...(cfg.pruebas ?? {}) } as Config["pruebas"];
  cfg.revision ??= { activo: true };
  cfg.git = { ...{ activo: true, ramaPorObjetivo: true, commitPorTarea: true, push: false, pullRequest: false }, ...(cfg.git ?? {}) } as Config["git"];
  cfg.workspace = path.resolve(HOME, cfg.workspace ?? "./workspace");
  fs.mkdirSync(cfg.workspace, { recursive: true });
  return cfg;
}

loadEnv();

// Objeto único y mutable: el resto del código lo importa y siempre ve la versión actual.
export const config: Config = readConfigFile();
console.log("config: " + CONFIG_FILE + " · revisor=" + config.roles.revisor.provider + "/" + config.roles.revisor.model + " · tope=$" + config.limites.maxCosteUsdPorObjetivo);

export function reloadConfig() {
  const fresh = readConfigFile();
  for (const k of Object.keys(config)) delete (config as unknown as Record<string, unknown>)[k];
  Object.assign(config, fresh);
}

// Valida lo mínimo y guarda. El workspace se guarda relativo a HOME para que el JSON sea portable.
export function saveConfig(nueva: Config) {
  // Archivos de versiones anteriores pueden no traer roles/secciones nuevas: se completan con los valores actuales.
  nueva.roles = { ...config.roles, ...(nueva.roles ?? {}) };
  nueva.limites = { ...config.limites, ...(nueva.limites ?? {}) };
  const roles: RoleName[] = ["planificador", "ejecutor", "revisor", "entrevistador", "consultor"];
  for (const r of roles) {
    const rc = nueva.roles[r];
    if (!rc || !rc.provider || !rc.model) throw new Error("El rol '" + r + "' necesita proveedor y modelo.");
  }
  const lim = nueva.limites ?? config.limites;
  for (const [k, v] of Object.entries(lim)) if (typeof v !== "number" || !(v >= 0)) throw new Error("Límite inválido: " + k);
  for (const c of nueva.cron ?? []) if (!c.nombre || !c.expresion) throw new Error("Cada tarea programada necesita nombre y expresión cron.");
  const rel = path.relative(HOME, path.resolve(HOME, nueva.workspace || "./workspace")).replaceAll("\\", "/");
  const aGuardar = { ...nueva, workspace: rel && !rel.startsWith("..") ? "./" + rel : "./workspace" };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(aGuardar, null, 2), "utf8");
  reloadConfig();
}
