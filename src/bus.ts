import { EventEmitter } from "node:events";

export interface ColmenaEvent {
  ts: string;
  runId: string;
  type: string;   // run.started, plan.ready, task.started, agent.call, agent.tool, task.review, task.done, run.finished, run.error
  data?: Record<string, unknown>;
  msg?: string;
}

class Bus extends EventEmitter {
  ultimos: ColmenaEvent[] = [];   // últimos 500 eventos (sin el run completo, para no acumular memoria)
  emitEvent(runId: string, type: string, msg?: string, data?: Record<string, unknown>) {
    const ev: ColmenaEvent = { ts: new Date().toISOString(), runId, type, msg, data };
    this.ultimos.push({ ...ev, data: undefined });
    if (this.ultimos.length > 500) this.ultimos.shift();
    this.emit("event", ev);
    return ev;
  }
}

export const bus = new Bus();
bus.setMaxListeners(100);
