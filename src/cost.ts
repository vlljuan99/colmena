import { config } from "./config.js";
import type { Usage } from "./providers/types.js";

// Coste en USD de una llamada. DeepSeek tiene tarifa reducida fuera de hora punta.
export function costOf(model: string, usage: Usage, when = new Date()): number {
  const p = config.precios[model];
  if (!p) return 0;
  let rate = { input: p.input, output: p.output, cacheRead: p.cacheRead };
  if (p.offPeak && p.peakHoursUTC) {
    const h = when.getUTCHours();
    const diaPunta = !p.peakDaysUTC || p.peakDaysUTC.includes(when.getUTCDay());
    const peak = diaPunta && p.peakHoursUTC.some(([a, b]) => h >= a && h < b);
    if (!peak) rate = p.offPeak;
  }
  if (p.cliff && usage.input > p.cliff.inputTokens) {
    rate = { input: p.cliff.input, output: p.cliff.output, cacheRead: p.cliff.cacheRead ?? rate.cacheRead };
  }
  const uncached = Math.max(0, usage.input - usage.cacheRead);
  return (uncached * rate.input + usage.cacheRead * rate.cacheRead + usage.output * rate.output) / 1_000_000;
}

export interface ModelTotals { calls: number; input: number; output: number; cacheRead: number; usd: number }

export class CostTracker {
  porModelo: Record<string, ModelTotals> = {};
  totalUsd = 0;

  add(model: string, usage: Usage): number {
    const usd = costOf(model, usage);
    const t = (this.porModelo[model] ??= { calls: 0, input: 0, output: 0, cacheRead: 0, usd: 0 });
    t.calls++; t.input += usage.input; t.output += usage.output; t.cacheRead += usage.cacheRead; t.usd += usd;
    this.totalUsd += usd;
    return usd;
  }
}
