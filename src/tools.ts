import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { ToolDef } from "./providers/types.js";

const MAX_OUT = 20_000;
const ROOT = () => config.workspace;

// Todas las rutas se confinan al workspace: el modelo nunca sale de ahí.
function safePath(p: unknown): string {
  const rel = typeof p === "string" && p.trim() ? p : ".";
  const root = ROOT();
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error("Ruta fuera del workspace: " + rel);
  return abs;
}

function truncate(s: string, max = MAX_OUT): string {
  return s.length > max ? s.slice(0, max) + "\n...[truncado, " + (s.length - max) + " caracteres más]" : s;
}

export const getToolDefs = (): ToolDef[] => [
  {
    name: "list_files",
    description: "Lista archivos y carpetas del workspace (recursivo, ignora node_modules y .git).",
    parameters: { type: "object", properties: { path: { type: "string", description: "Carpeta relativa al workspace. Por defecto la raíz." } }, additionalProperties: false },
  },
  {
    name: "read_file",
    description: "Lee un archivo de texto del workspace.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  },
  {
    name: "write_file",
    description: "Escribe (crea o sobrescribe) un archivo de texto en el workspace. Crea las carpetas necesarias.",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false },
  },
  {
    name: "run_command",
    description: "Ejecuta un comando de shell dentro del workspace (timeout " + config.limites.timeoutComandoSeg + "s). Devuelve stdout, stderr y código de salida.",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"], additionalProperties: false },
  },
  {
    name: "fetch_url",
    description: "Descarga una URL (http/https) y devuelve su texto sin etiquetas HTML.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
  },
];

export async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "list_files": return listFiles(safePath(args.path));
      case "read_file": return truncate(fs.readFileSync(safePath(args.path), "utf8"));
      case "write_file": {
        const abs = safePath(args.path);
        const content = String(args.content ?? "");
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, "utf8");
        return "Escrito " + path.relative(ROOT(), abs) + " (" + content.length + " caracteres).";
      }
      case "run_command": return await runCommand(String(args.command ?? ""));
      case "fetch_url": return await fetchUrl(String(args.url ?? ""));
      default: return "Herramienta desconocida: " + name;
    }
  } catch (e) {
    return "ERROR: " + (e as Error).message;
  }
}

function listFiles(dir: string): string {
  const out: string[] = [];
  const root = ROOT();
  const walk = (d: string, depth: number) => {
    if (depth > 6 || out.length > 500) return;
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      const full = path.join(d, ent.name);
      out.push(path.relative(root, full).replaceAll("\\", "/") + (ent.isDirectory() ? "/" : ""));
      if (ent.isDirectory()) walk(full, depth + 1);
    }
  };
  walk(dir, 0);
  return out.length ? out.join("\n") : "(vacío)";
}

function runCommand(command: string): Promise<string> {
  return new Promise((resolve) => {
    exec(command, { cwd: ROOT(), timeout: config.limites.timeoutComandoSeg * 1000, maxBuffer: 5_000_000 }, (err, stdout, stderr) => {
      const code = err && "code" in err ? err.code : 0;
      const tail = err?.killed ? "\n[timeout]" : "";
      resolve(truncate("exit=" + code + "\n--- stdout ---\n" + stdout + "\n--- stderr ---\n" + stderr + tail));
    });
  });
}

async function fetchUrl(url: string): Promise<string> {
  if (!/^https?:\/\//.test(url)) throw new Error("Solo http/https");
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "colmena/0.1" } });
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncate("HTTP " + res.status + "\n" + text, 30_000);
}
