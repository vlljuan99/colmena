import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { turnoAsistente, type TurnoAsistente } from "./asistente.js";
import { bus, type ColmenaEvent } from "./bus.js";
import { turnoConsultor, type TurnoConsultor } from "./consultor.js";
import { config, HOME, KEY_VARS, keyStatus, PKG_ROOT, saveConfig, saveKeys, type Config, type KeyVar } from "./config.js";
import { continuarRun, detenerRun, ejecutarLatido, ejecutarObjetivo, runActivo } from "./orchestrator.js";
import { clonar, estadoRepo, listarReposGitHub, repoDir, reposDisponibles } from "./git.js";
import { providerStatus, resetProviders } from "./providers/index.js";
import { cronInfo, iniciarScheduler } from "./scheduler.js";
import { listRuns, loadRun } from "./store.js";

const PORT = Number(process.env.PORT ?? 4180);
const ARRANQUE = new Date().toISOString();
const PUBLIC = path.join(PKG_ROOT, "public");
iniciarScheduler();

// Últimos eventos en memoria para que un cliente recién conectado vea el contexto.
const recientes: ColmenaEvent[] = [];
bus.on("event", (ev: ColmenaEvent) => { recientes.push(ev); if (recientes.length > 500) recientes.shift(); });

const sseClients = new Set<http.ServerResponse>();
bus.on("event", (ev: ColmenaEvent) => {
  const line = "data: " + JSON.stringify(ev) + "\n\n";
  for (const res of sseClients) res.write(line);
});

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

// Borrador de objetivo: texto pendiente que el panel carga en el cuadro (lo puede dejar la CLI, un script o Colmena misma).
const BORRADOR = path.join(HOME, "borrador.txt");
const leerBorrador = () => (fs.existsSync(BORRADOR) ? fs.readFileSync(BORRADOR, "utf8").trim() : "");

function estado() {
  const runs = listRuns();
  const mes = new Date().toISOString().slice(0, 7);
  return {
    arranque: ARRANQUE,
    borrador: leerBorrador(),
    mesUsd: runs.filter((r) => r.inicio.startsWith(mes)).reduce((a, r) => a + (r.costeUsd || 0), 0),
    roles: config.roles, limites: config.limites, asistente: config.asistente, pruebas: config.pruebas, revision: config.revision, git: config.git, proveedores: providerStatus(),
    mock: process.env.COLMENA_MOCK === "1", workspace: config.workspace, home: HOME, cron: cronInfo(),
    activo: runActivo(),
    runs: runs.slice(0, 50).map(({ id, objetivo, estado, inicio, fin, costeUsd, origen }) => ({ id, objetivo, estado, inicio, fin, costeUsd, origen })),
    eventos: recientes.slice(-200),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;

  try {
    if (p === "/api/state") return json(res, 200, estado());

    // ---- configuración editable desde el panel ----
    if (p === "/api/config" && req.method === "GET") {
      return json(res, 200, { config, claves: keyStatus(), home: HOME });
    }
    if (p === "/api/config" && req.method === "PUT") {
      const body = (await readBody(req)) as unknown as Config;
      saveConfig(body);
      iniciarScheduler();
      bus.emitEvent("sistema", "log", "Configuración guardada");
      return json(res, 200, { ok: true, config, cron: cronInfo() });
    }
    if (p === "/api/keys" && req.method === "PUT") {
      const body = await readBody(req);
      const cambios: Partial<Record<KeyVar, string | null>> = {};
      for (const k of KEY_VARS) {
        const v = body[k];
        if (v === null) cambios[k] = null;
        else if (typeof v === "string" && v.trim()) cambios[k] = v;
      }
      saveKeys(cambios);
      resetProviders();
      bus.emitEvent("sistema", "log", "Claves API actualizadas");
      return json(res, 200, { ok: true, claves: keyStatus() });
    }

    // Entrevista para pulir el objetivo (rol entrevistador). Sin estado: el cliente manda todo el historial.
    if (p === "/api/asistente" && req.method === "POST") {
      const body = await readBody(req);
      const historial = (Array.isArray(body.historial) ? body.historial : []) as TurnoAsistente[];
      if (!historial.length) return json(res, 400, { error: "Falta el historial" });
      return json(res, 200, await turnoAsistente(historial));
    }

    // Chat de estado (rol consultor, barato). Sin estado: el cliente manda el historial.
    if (p === "/api/consultor" && req.method === "POST") {
      const body = await readBody(req);
      const historial = (Array.isArray(body.historial) ? body.historial : []) as TurnoConsultor[];
      if (!historial.length) return json(res, 400, { error: "Falta el historial" });
      return json(res, 200, await turnoConsultor(historial));
    }

    // ---- repositorio ----
    if (p === "/api/git" && req.method === "GET") {
      const dir = repoDir();
      return json(res, 200, { repos: reposDisponibles(), activo: dir ? await estadoRepo(dir) : null, config: config.git, token: !!process.env.GITHUB_TOKEN });
    }
    if (p === "/api/git/clone" && req.method === "POST") {
      const body = await readBody(req);
      const url = String(body.url ?? "").trim();
      if (!url) return json(res, 400, { error: "Falta la URL" });
      const carpeta = await clonar(url);
      saveConfig({ ...config, git: { ...config.git, repo: carpeta } });
      bus.emitEvent("sistema", "git", "git: clonado " + url + " en " + carpeta);
      return json(res, 200, { ok: true, carpeta });
    }
    if (p === "/api/git/repo" && req.method === "PUT") {
      const body = await readBody(req);
      const repo = String(body.repo ?? "");
      if (!reposDisponibles().includes(repo)) return json(res, 400, { error: "Esa carpeta no es un repositorio del workspace" });
      saveConfig({ ...config, git: { ...config.git, repo } });
      return json(res, 200, { ok: true });
    }
    if (p === "/api/git/opciones" && req.method === "PUT") {
      const body = await readBody(req);
      const g = { ...config.git };
      for (const k of ["activo", "ramaPorObjetivo", "commitPorTarea", "push", "pullRequest"] as const) if (typeof body[k] === "boolean") g[k] = body[k] as boolean;
      saveConfig({ ...config, git: g });
      return json(res, 200, { ok: true, config: config.git });
    }
    if (p === "/api/github/repos" && req.method === "GET") return json(res, 200, { repos: await listarReposGitHub() });

    if (p === "/api/borrador" && req.method === "PUT") {
      const body = await readBody(req);
      const texto = String(body.texto ?? "").trim();
      if (texto) fs.writeFileSync(BORRADOR, texto, "utf8"); else if (fs.existsSync(BORRADOR)) fs.unlinkSync(BORRADOR);
      return json(res, 200, { ok: true });
    }

    if (p === "/api/runs" && req.method === "POST") {
      const body = await readBody(req);
      const objetivo = String(body.objetivo ?? "").trim();
      if (!objetivo) return json(res, 400, { error: "Falta el objetivo" });
      if (runActivo()) return json(res, 409, { error: "Ya hay un objetivo en curso" });
      const lanzar = body.modo === "latido" ? ejecutarLatido : ejecutarObjetivo;
      lanzar(objetivo, "web").catch(() => { /* ya se registra como run.error */ });
      if (fs.existsSync(BORRADOR) && leerBorrador() === objetivo) fs.unlinkSync(BORRADOR);
      return json(res, 202, { ok: true });
    }
    const mRun = p.match(/^\/api\/runs\/([\w-]+)$/);
    if (mRun) {
      const run = loadRun(mRun[1]) ?? (runActivo()?.id === mRun[1] ? runActivo() : undefined);
      return run ? json(res, 200, run) : json(res, 404, { error: "No existe" });
    }
    const mCont = p.match(/^\/api\/runs\/([\w-]+)\/continuar$/);
    if (mCont && req.method === "POST") {
      const previo = loadRun(mCont[1]);
      if (!previo) return json(res, 404, { error: "No existe" });
      if (runActivo()) return json(res, 409, { error: "Ya hay un objetivo en curso" });
      continuarRun(previo).catch(() => { /* ya se registra como run.error */ });
      return json(res, 202, { ok: true });
    }
    const mStop = p.match(/^\/api\/runs\/([\w-]+)\/stop$/);
    if (mStop && req.method === "POST") return json(res, 200, { ok: detenerRun(mStop[1]) });

    if (p === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(": conectado\n\n");
      sseClients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
      req.on("close", () => { clearInterval(ping); sseClients.delete(res); });
      return;
    }

    // Archivos estáticos del panel
    const file = path.join(PUBLIC, p === "/" ? "index.html" : p);
    if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
      res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
      return fs.createReadStream(file).pipe(res);
    }
    json(res, 404, { error: "No encontrado" });
  } catch (e) {
    json(res, 500, { error: (e as Error).message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const st = providerStatus();
  console.log("🐝 Colmena en http://localhost:" + PORT + "  (datos en " + HOME + ")");
  console.log("   Roles: " + Object.entries(config.roles).map(([r, c]) => r + "=" + c.provider + "/" + c.model).join(" · "));
  console.log("   Claves: " + Object.entries(st).map(([k, v]) => k + (v ? " ✔" : " ✘")).join("  ") + (process.env.COLMENA_MOCK === "1" ? "   (MODO SIMULADO)" : ""));
  const jobs = cronInfo();
  if (jobs.length) console.log("   Cron activos: " + jobs.map((j) => j.nombre + " (" + j.expresion + ")").join(", "));
});
