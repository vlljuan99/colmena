import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export interface ResultadoPruebas { dir: string; comando: string; ok: boolean; salida: string }

// Detección del comando de tests por los archivos del proyecto. Se busca en el workspace y en sus subcarpetas de primer nivel.
function detectar(dir: string): string | null {
  const hay = (f: string) => fs.existsSync(path.join(dir, f));
  if (hay("package.json")) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { scripts?: Record<string, string> };
      const t = pkg.scripts?.test;
      if (t && !/no test specified/i.test(t)) return "npm test --silent";
    } catch { /* package.json roto: sin tests */ }
  }
  if (hay("pytest.ini") || hay("conftest.py") || hay("tests") || hay("test") && fs.readdirSync(path.join(dir, "test")).some((f) => f.endsWith(".py"))) {
    if (hay("pyproject.toml") || hay("requirements.txt") || hay("pytest.ini") || hay("conftest.py")) return "python -m pytest -q";
  }
  if (hay("go.mod")) return "go test ./...";
  if (hay("Cargo.toml")) return "cargo test -q";
  return null;
}

const IGNORAR = new Set(["node_modules", ".git", "dist", "build", "coverage", ".venv", "venv", "__pycache__", "target", "release"]);

// Proyectos con tests en el workspace, buscando hasta 3 niveles (p. ej. workspace/repo/servicio/package.json).
export function comandosDePruebas(): { dir: string; comando: string }[] {
  const ws = config.workspace;
  if (config.pruebas.comando?.trim()) return [{ dir: ws, comando: config.pruebas.comando.trim() }];
  const out: { dir: string; comando: string }[] = [];
  const walk = (d: string, depth: number) => {
    if (out.length >= 6) return;
    const c = detectar(d);
    if (c) out.push({ dir: d, comando: c });
    if (depth >= 3) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory() && !IGNORAR.has(e.name) && !e.name.startsWith(".")) walk(path.join(d, e.name), depth + 1);
    }
  };
  walk(ws, 0);
  return out;
}

export async function ejecutarPruebas(): Promise<ResultadoPruebas[]> {
  const res: ResultadoPruebas[] = [];
  for (const { dir, comando } of comandosDePruebas()) {
    res.push(await new Promise<ResultadoPruebas>((resolve) => {
      exec(comando, { cwd: dir, timeout: config.pruebas.timeoutSeg * 1000, maxBuffer: 5_000_000, windowsHide: true }, (err, stdout, stderr) => {
        const salida = ((stdout ?? "") + "\n" + (stderr ?? "")).trim();
        resolve({ dir: path.relative(config.workspace, dir) || ".", comando, ok: !err, salida: salida.length > 6000 ? salida.slice(-6000) : salida });
      });
    }));
  }
  return res;
}

export function resumenPruebas(r: ResultadoPruebas[]): string {
  if (!r.length) return "No se detectaron tests automáticos en el workspace.";
  return r.map((x) => "[" + (x.ok ? "PASAN" : "FALLAN") + "] " + x.comando + " (en " + x.dir + ")\n" + x.salida).join("\n\n");
}
