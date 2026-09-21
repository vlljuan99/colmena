import { Cron } from "croner";
import { bus } from "./bus.js";
import { config } from "./config.js";
import { ejecutarLatido, ejecutarObjetivo } from "./orchestrator.js";

export interface CronInfo { nombre: string; expresion: string; modo: string; proxima: string | null }

let jobs: Cron[] = [];

// Tareas programadas definidas en la config → "cron". Se puede llamar de nuevo tras guardar la config.
export function iniciarScheduler(): CronInfo[] {
  for (const j of jobs) j.stop();
  jobs = [];
  const info: CronInfo[] = [];
  for (const c of config.cron.filter((c) => c.activo)) {
    const modo = c.modo ?? "objetivo";
    try {
      const job = new Cron(c.expresion, { name: c.nombre, protect: true }, async () => {
        bus.emitEvent("cron", "log", "Cron '" + c.nombre + "' (" + modo + ")");
        try { await (modo === "latido" ? ejecutarLatido(c.objetivo, "cron") : ejecutarObjetivo(c.objetivo, "cron")); }
        catch (e) { bus.emitEvent("cron", "run.error", "Cron '" + c.nombre + "': " + (e as Error).message); }
      });
      jobs.push(job);
      info.push({ nombre: c.nombre, expresion: c.expresion, modo, proxima: job.nextRun()?.toISOString() ?? null });
    } catch (e) {
      bus.emitEvent("cron", "run.error", "Cron '" + c.nombre + "' inválido: " + (e as Error).message);
    }
  }
  return info;
}

export function cronInfo(): CronInfo[] {
  return jobs.map((j) => {
    const c = config.cron.find((x) => x.nombre === j.name);
    return { nombre: j.name ?? "", expresion: c?.expresion ?? "", modo: c?.modo ?? "objetivo", proxima: j.nextRun()?.toISOString() ?? null };
  });
}
