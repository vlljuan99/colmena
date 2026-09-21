import { randomUUID } from "node:crypto";
import { PresupuestoAgotado, runAgent } from "./agent.js";
import { bus } from "./bus.js";
import { config, reloadConfig } from "./config.js";
import { CostTracker } from "./cost.js";
import { commitTodo, crearPullRequest, crearRama, estadoRepo, gitDisponible, push, ramaActual, remotoGitHub, repoDir } from "./git.js";
import { ejecutarPruebas, resumenPruebas } from "./pruebas.js";
import { SYSTEM_EJECUTOR, SYSTEM_INFORME, SYSTEM_LATIDO, SYSTEM_PLANIFICADOR, SYSTEM_REVISOR } from "./prompts.js";
import { CATEGORIAS, saveRun, type Categoria, type Run, type Task } from "./store.js";
import { getToolDefs } from "./tools.js";
import { parseJson } from "./util.js";

const READ_ONLY_TOOLS = () => getToolDefs().filter((t) => t.name === "list_files" || t.name === "read_file");
const REVIEW_TOOLS = () => getToolDefs().filter((t) => ["list_files", "read_file", "run_command"].includes(t.name));

// Rama por objetivo. Si no hay repo o git no está instalado, se sigue sin git (se avisa en el registro).
async function prepararGit(run: Run) {
  if (!config.git.activo) return;
  const dir = repoDir();
  if (!dir) { bus.emitEvent(run.id, "log", "git: el workspace no es un repositorio; se trabaja sin ramas ni commits"); return; }
  if (!(await gitDisponible())) { bus.emitEvent(run.id, "log", "git: no está instalado en el PC"); return; }
  const base = await ramaActual(dir);
  const rama = config.git.ramaPorObjetivo ? "colmena/" + run.id.slice(11, 19).replaceAll("-", "") + "-" + run.id.slice(-6) : base;
  if (config.git.ramaPorObjetivo && !(await crearRama(dir, rama))) { bus.emitEvent(run.id, "run.error", "git: no se pudo crear la rama " + rama); return; }
  run.git = { dir, rama, base, commits: [] };
  bus.emitEvent(run.id, "git", "git: rama " + rama + " (desde " + base + ")", { run });
}

async function commitTarea(run: Run, tarea: Task) {
  if (!run.git || !config.git.commitPorTarea) return;
  const hash = await commitTodo(run.git.dir, "colmena(" + tarea.id + "): " + tarea.titulo + "\n\n" + (tarea.informe ?? "").slice(0, 1500));
  if (hash) { run.git.commits.push(hash); bus.emitEvent(run.id, "git", "git: commit " + hash + " · " + tarea.titulo, { run }); }
}

async function cerrarGit(run: Run) {
  if (!run.git) return;
  try {
    if (config.git.push || config.git.pullRequest) {
      const p = await push(run.git.dir, run.git.rama);
      if (!p.ok) throw new Error("push falló: " + p.out.slice(0, 300));
      bus.emitEvent(run.id, "git", "git: push de " + run.git.rama, { run });
    }
    if (config.git.pullRequest) {
      const remoto = await remotoGitHub(run.git.dir);
      if (!remoto) throw new Error("el remoto origin no es de GitHub");
      const body = (run.informeFinal ?? "").slice(0, 60_000) + "\n\n---\n🐝 Generado por Colmena · objetivo: " + run.objetivo.slice(0, 500);
      run.git.pr = await crearPullRequest({ ...remoto, head: run.git.rama, base: run.git.base, title: run.objetivo.split("\n")[0].slice(0, 100), body });
      bus.emitEvent(run.id, "git", "git: pull request " + run.git.pr, { run });
    }
  } catch (e) {
    run.git.error = (e as Error).message;
    bus.emitEvent(run.id, "run.error", "git: " + run.git.error, { run });
  }
}

// Contexto del repositorio activo para el planificador (evita que planifique clonar lo que ya está).
async function contextoRepo(run: Run): Promise<string> {
  const dir = run.git?.dir ?? repoDir();
  if (!dir) return "";
  const e = await estadoRepo(dir);
  return "\n\nREPOSITORIO YA PRESENTE EN EL WORKSPACE: carpeta " + e.carpeta + (e.remoto ? " (GitHub " + e.remoto + ")" : "") +
    ", rama actual " + (run.git?.rama ?? e.rama) + ". Trabaja dentro de esa carpeta; no lo vuelvas a clonar. Colmena hará los commits.";
}

// Pruebas obligatorias tras cada tarea. Devuelve null si pasan (o no hay tests), o el texto del fallo para el ejecutor.
async function comprobarPruebas(run: Run, tarea: Task): Promise<string | null> {
  if (!config.pruebas.obligatorias) return null;
  const res = await ejecutarPruebas();
  const resumen = resumenPruebas(res);
  const ok = res.every((r) => r.ok);
  run.pruebas = { ok, resumen };
  if (res.length) bus.emitEvent(run.id, "tests", "tests " + (ok ? "PASAN" : "FALLAN") + " tras " + tarea.id + ": " + res.map((r) => r.comando + " → " + (r.ok ? "ok" : "fallo")).join(", "), { run, taskId: tarea.id, ok });
  return ok ? null : resumen;
}

const activos = new Map<string, { run: Run; stop: boolean }>();

export function runActivo(): Run | undefined {
  return [...activos.values()][0]?.run;
}

export function detenerRun(id: string): boolean {
  const a = activos.get(id);
  if (!a) return false;
  a.stop = true;
  return true;
}


function nuevoRun(objetivo: string, origen: Run["origen"]): Run {
  return {
    id: new Date().toISOString().slice(0, 19).replaceAll(/[:T]/g, "-") + "-" + randomUUID().slice(0, 6),
    objetivo, origen, estado: "planificando", inicio: new Date().toISOString(),
    tareas: [], costeUsd: 0, porModelo: {},
  };
}

// Latido: comprobación rutinaria que va directo al ejecutor barato. Sin planificador ni revisor (el hilo: "no ejecutes
// heartbeats en el modelo frontier"). Ideal para cron: "¿hay algo nuevo en X?", "¿siguen pasando los tests?".
export async function ejecutarLatido(objetivo: string, origen: Run["origen"] = "cron"): Promise<Run> {
  if (activos.size > 0) throw new Error("Ya hay un objetivo en curso; el latido se salta esta vez.");
  reloadConfig();
  const run = nuevoRun(objetivo, origen);
  run.estado = "ejecutando";
  run.resumenPlan = "Latido: solo ejecutor, sin planificación ni revisión.";
  const tarea: Task = { id: "latido", titulo: "Comprobación rutinaria", categoria: "monitorizacion", instrucciones: objetivo, entregable: "Informe breve", depende_de: [], estado: "en_curso", intentos: 1 };
  run.tareas = [tarea];
  const ctl = { run, stop: false };
  activos.set(run.id, ctl);
  const cost = new CostTracker();
  const sync = () => { run.costeUsd = cost.totalUsd; run.porModelo = cost.porModelo; saveRun(run); };
  bus.emitEvent(run.id, "run.started", "Latido: " + objetivo, { run });
  sync();
  try {
    tarea.informe = await runAgent({
      runId: run.id, role: config.roles.ejecutor, roleLabel: "ejecutor", cost, shouldStop: () => ctl.stop,
      system: SYSTEM_LATIDO(), tools: getToolDefs(), maxSteps: 12, prompt: objetivo,
    });
    tarea.estado = ctl.stop ? "fallida" : "hecha";
    run.informeFinal = tarea.informe;
    run.estado = ctl.stop ? "detenida" : "terminada";
  } catch (e) {
    tarea.estado = "fallida"; run.estado = "error"; run.error = (e as Error).message;
    bus.emitEvent(run.id, "run.error", run.error, { run });
  } finally {
    run.fin = new Date().toISOString();
    sync();
    activos.delete(run.id);
    bus.emitEvent(run.id, "run.finished", "Estado: " + run.estado + " · coste $" + run.costeUsd.toFixed(4), { run });
  }
  return run;
}

// Relanza un objetivo detenido (presupuesto, parada manual o error) sin rehacer lo ya aprobado.
export async function continuarRun(previo: Run): Promise<Run> {
  const hechas = previo.tareas.filter((t) => t.estado === "hecha");
  const resto = previo.tareas.filter((t) => t.estado !== "hecha");
  const objetivo = previo.objetivo.replace(/\n+### ESTADO PREVIO[\s\S]*$/, "") +
    "\n\n### ESTADO PREVIO (continuación de la ejecución " + previo.id + ")\n" +
    "Estas tareas YA ESTÁN HECHAS Y APROBADAS; no las repitas, apóyate en su resultado:\n" +
    (hechas.map((t) => "- " + t.titulo + " → " + (t.informe ?? "").replace(/\s+/g, " ").slice(0, 400)).join("\n") || "- (ninguna)") +
    "\n\nQuedaban por hacer (puede haber trabajo parcial en el workspace; compruébalo antes de rehacer):\n" +
    (resto.map((t) => "- " + t.titulo + ": " + t.instrucciones.replace(/\s+/g, " ").slice(0, 300)).join("\n") || "- (ninguna)") +
    "\n\nPlanifica SOLO lo que falta.";
  return ejecutarObjetivo(objetivo, previo.origen);
}

interface PlanJson { resumen?: string; tareas?: Partial<Task>[] }
interface ReviewJson { aprobado?: boolean; comentarios?: string }

export async function ejecutarObjetivo(objetivo: string, origen: Run["origen"] = "web"): Promise<Run> {
  if (activos.size > 0) throw new Error("Ya hay un objetivo en curso. Espera a que termine o detenlo.");
  reloadConfig();

  const run = nuevoRun(objetivo, origen);
  const ctl = { run, stop: false };
  activos.set(run.id, ctl);
  const cost = new CostTracker();
  const shouldStop = () => ctl.stop;
  const sync = () => { run.costeUsd = cost.totalUsd; run.porModelo = cost.porModelo; saveRun(run); };
  const roles = config.roles;

  bus.emitEvent(run.id, "run.started", "Objetivo recibido: " + objetivo, { run });
  sync();

  try {
    await prepararGit(run);
    sync();
    // 1) PLAN
    const planText = await runAgent({
      runId: run.id, role: roles.planificador, roleLabel: "planificador", cost, shouldStop,
      system: SYSTEM_PLANIFICADOR(), tools: READ_ONLY_TOOLS(), maxSteps: 8,
      prompt: "OBJETIVO DEL USUARIO:\n" + objetivo + (await contextoRepo(run)) + "\n\nInspecciona el workspace si te ayuda y devuelve el plan en JSON.",
    });
    const plan = parseJson<PlanJson>(planText);
    run.resumenPlan = plan.resumen ?? "";
    run.tareas = (plan.tareas ?? []).slice(0, config.limites.maxTareasPorObjetivo).map((t, i) => ({
      id: t.id ?? "t" + (i + 1),
      titulo: t.titulo ?? "Tarea " + (i + 1),
      categoria: CATEGORIAS.includes(t.categoria as Categoria) ? (t.categoria as Categoria) : "codigo",
      instrucciones: t.instrucciones ?? "",
      entregable: t.entregable ?? "",
      depende_de: t.depende_de ?? [],
      estado: "pendiente", intentos: 0,
    }));
    if (!run.tareas.length) throw new Error("El planificador no propuso tareas.");
    run.estado = "ejecutando";
    sync();
    bus.emitEvent(run.id, "plan.ready", "Plan: " + run.tareas.length + " tareas · " + run.resumenPlan, { run });

    // 2) EJECUTAR + REVISAR. Las tareas cuyas dependencias están hechas se lanzan en paralelo (hasta
    //    limites.ejecutoresParalelos obreras). La verificación (tests, revisor, commit) va en serie para no pisarse.
    const hechas = new Set<string>();
    const enCurso = new Map<string, Promise<void>>();
    const paralelos = Math.max(1, config.limites.ejecutoresParalelos || 1);
    let numObrera = 0;
    let cola: Promise<void> = Promise.resolve();
    const enSerie = <T>(fn: () => Promise<T>): Promise<T> => { const p = cola.then(fn); cola = p.then(() => undefined, () => undefined); return p; };
    let sinPresupuesto = false;
    while (!ctl.stop && !sinPresupuesto) {
      for (const tarea of run.tareas) {
        if (enCurso.size >= paralelos) break;
        if (cost.totalUsd >= config.limites.maxCosteUsdPorObjetivo) { sinPresupuesto = true; break; }
        if (tarea.estado !== "pendiente" || enCurso.has(tarea.id)) continue;
        if (!tarea.depende_de.every((d) => hechas.has(d))) continue;
        tarea.obrera = ++numObrera;
        const p = ejecutarTarea(run, tarea, cost, shouldStop, sync, enSerie)
          .catch((e) => {
            if (e instanceof PresupuestoAgotado) { sinPresupuesto = true; tarea.estado = "pendiente"; tarea.informe = "Interrumpida por presupuesto (puede haber trabajo parcial en el workspace)."; }
            else { tarea.estado = "fallida"; tarea.informe = "Error: " + (e as Error).message; }
          })
          .then(() => { if ((tarea.estado as Task["estado"]) === "hecha") hechas.add(tarea.id); enCurso.delete(tarea.id); });
        enCurso.set(tarea.id, p);
      }
      if (!enCurso.size) break;
      await Promise.race(enCurso.values());
    }
    await Promise.all(enCurso.values());
    if (sinPresupuesto) {
      const pendientes = run.tareas.filter((t) => t.estado === "pendiente");
      run.estado = "detenida";
      run.error = "Presupuesto agotado ($" + cost.totalUsd.toFixed(2) + " de $" + config.limites.maxCosteUsdPorObjetivo + "). " +
        (pendientes.length ? "Pendientes: " + pendientes.map((t) => t.id).join(", ") + ". " : "") + "Sube el tope en ⚙ → Límites y pulsa Continuar.";
      run.informeFinal = "Ejecución detenida por presupuesto. Tareas hechas: " + run.tareas.filter((t) => t.estado === "hecha").map((t) => t.titulo).join("; ") +
        ". Pendientes: " + pendientes.map((t) => t.titulo).join("; ") + ".";
      bus.emitEvent(run.id, "run.error", run.error, { run });
      return run;
    }
    for (const t of run.tareas) if (t.estado === "pendiente" && !ctl.stop) { t.estado = "fallida"; t.informe = "Bloqueada: dependencias no completadas."; }

    // 3) INFORME FINAL
    if (ctl.stop) {
      run.estado = "detenida";
    } else {
      const resumenTareas = run.tareas.map((t) =>
        "- [" + t.estado + "] " + t.titulo + "\n  Informe: " + (t.informe ?? "").slice(0, 1500) + (t.revision ? "\n  Revisión: " + t.revision.slice(0, 500) : "")).join("\n");
      run.informeFinal = await runAgent({
        runId: run.id, role: roles.planificador, roleLabel: "planificador", cost, shouldStop,
        system: SYSTEM_INFORME(), tools: READ_ONLY_TOOLS(), maxSteps: 6,
        prompt: "OBJETIVO: " + objetivo + "\n\nRESULTADO DE LAS TAREAS:\n" + resumenTareas +
          (run.pruebas ? "\n\nÚLTIMO RESULTADO DE TESTS:\n" + run.pruebas.resumen.slice(0, 3000) : "") +
          (run.git ? "\n\nGIT: rama " + run.git.rama + ", " + run.git.commits.length + " commits" : "") +
          "\n\nEscribe el INFORME FINAL.",
      });
      run.estado = "terminada";
      await cerrarGit(run);
    }
  } catch (e) {
    run.estado = "error";
    run.error = (e as Error).message;
    bus.emitEvent(run.id, "run.error", run.error, { run });
  } finally {
    run.fin = new Date().toISOString();
    sync();
    activos.delete(run.id);
    bus.emitEvent(run.id, "run.finished", "Estado: " + run.estado + " · coste total $" + run.costeUsd.toFixed(4), { run });
  }
  return run;
}

async function ejecutarTarea(run: Run, tarea: Task, cost: CostTracker, shouldStop: () => boolean, sync: () => void, enSerie: <T>(fn: () => Promise<T>) => Promise<T>) {
  const roles = config.roles;
  const contexto = run.tareas
    .filter((t) => tarea.depende_de.includes(t.id) && t.informe)
    .map((t) => "### " + t.titulo + "\n" + t.informe).join("\n\n");
  let feedback = "";

  for (let intento = 1; intento <= config.limites.maxReintentosPorTarea + 1; intento++) {
    if (shouldStop()) return;
    tarea.estado = "en_curso"; tarea.intentos = intento; sync();
    bus.emitEvent(run.id, "task.started", "Tarea " + tarea.id + " (intento " + intento + "): " + tarea.titulo, { run, taskId: tarea.id });

    tarea.informe = await runAgent({
      runId: run.id, role: roles.ejecutor, roleLabel: "ejecutor", taskId: tarea.id, cost, shouldStop,
      system: SYSTEM_EJECUTOR(), tools: getToolDefs(),
      prompt: "OBJETIVO GLOBAL (solo contexto): " + run.objetivo +
        "\n\nTU TAREA: " + tarea.titulo + "\n" + tarea.instrucciones +
        "\n\nENTREGABLE: " + tarea.entregable +
        (contexto ? "\n\nRESULTADOS DE TAREAS PREVIAS:\n" + contexto : "") +
        (feedback ? "\n\nEL REVISOR RECHAZÓ EL INTENTO ANTERIOR. Corrige esto:\n" + feedback : ""),
    });
    if (shouldStop()) return;

    // Tests obligatorios: si fallan, ni siquiera pasa por el revisor.
    const resultado = await enSerie(() => verificarTarea(run, tarea, cost, shouldStop, sync));
    if (resultado === "detenido") return;
    if (resultado === "aprobada") return;
    feedback = resultado;
  }
  tarea.estado = "fallida"; sync();
  bus.emitEvent(run.id, "task.done", "Tarea " + tarea.id + " fallida tras " + tarea.intentos + " intentos", { run, taskId: tarea.id });
}

// Tests → revisor → commit. Devuelve "aprobada", "detenido" o el feedback para el siguiente intento.
async function verificarTarea(run: Run, tarea: Task, cost: CostTracker, shouldStop: () => boolean, sync: () => void): Promise<string> {
  const roles = config.roles;
  {
    const fallo = await comprobarPruebas(run, tarea);
    sync();
    if (fallo) {
      tarea.revision = "Tests automáticos fallidos:\n" + fallo.slice(0, 4000);
      bus.emitEvent(run.id, "task.review", "Revisión " + tarea.id + ": RECHAZADA por tests fallidos", { run, taskId: tarea.id, aprobado: false });
      return "Los tests automáticos fallan. Salida:\n" + fallo.slice(0, 6000) + "\n\nArregla el código (o los tests si están mal planteados) hasta que pasen.";
    }

    if (!config.revision.activo) {
      tarea.estado = "hecha";
      tarea.revision = "Aprobada sin revisor (revisión por IA desactivada). " + (run.pruebas ? (run.pruebas.ok ? "Tests: pasan." : "") : "Sin tests automáticos.");
      await commitTarea(run, tarea);
      sync();
      bus.emitEvent(run.id, "task.done", "Tarea " + tarea.id + " completada (sin revisor)", { run, taskId: tarea.id });
      return "aprobada";
    }
    tarea.estado = "revisando"; sync();
    if (shouldStop()) return "detenido";
    const reviewText = await runAgent({
      runId: run.id, role: roles.revisor, roleLabel: "revisor", taskId: tarea.id, cost, shouldStop,
      system: SYSTEM_REVISOR(), tools: REVIEW_TOOLS(), maxSteps: 10,
      prompt: "TAREA: " + tarea.titulo + "\n" + tarea.instrucciones + "\nENTREGABLE ESPERADO: " + tarea.entregable +
        "\n\nINFORME DEL EJECUTOR:\n" + tarea.informe +
        "\n\nRESULTADO REAL DE LOS TESTS (ejecutados por Colmena):\n" + (run.pruebas?.resumen ?? "No se ejecutaron tests.").slice(0, 4000) +
        "\n\nInspecciona lo que necesites y responde con el JSON de revisión.",
    });
    let review: ReviewJson;
    try { review = parseJson<ReviewJson>(reviewText); } catch { review = { aprobado: true, comentarios: "(revisor sin JSON: " + reviewText.slice(0, 300) + ")" }; }
    tarea.revision = review.comentarios ?? "";
    bus.emitEvent(run.id, "task.review", "Revisión " + tarea.id + ": " + (review.aprobado ? "APROBADA" : "RECHAZADA") + " · " + tarea.revision.slice(0, 200), { run, taskId: tarea.id, aprobado: !!review.aprobado });

    if (review.aprobado) {
      tarea.estado = "hecha";
      await commitTarea(run, tarea);
      sync();
      bus.emitEvent(run.id, "task.done", "Tarea " + tarea.id + " completada", { run, taskId: tarea.id });
      return "aprobada";
    }
    return tarea.revision || "Rechazada por el revisor sin comentarios.";
  }
}
