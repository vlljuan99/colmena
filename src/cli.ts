import { bus } from "./bus.js";
import { ejecutarLatido, ejecutarObjetivo } from "./orchestrator.js";

// Uso: npm run goal -- "tu objetivo"          (plan → ejecutar → revisar)
//      npm run goal -- --latido "comprueba X"  (solo ejecutor barato)
const args = process.argv.slice(2);
const latido = args.includes("--latido");
const objetivo = args.filter((a) => a !== "--latido").join(" ").trim();
if (!objetivo) {
  console.error('Uso: npm run goal -- "Describe el objetivo"');
  process.exit(1);
}

bus.on("event", (ev) => {
  const hora = ev.ts.slice(11, 19);
  console.log(hora + " [" + ev.type + "] " + (ev.msg ?? ""));
});

const run = await (latido ? ejecutarLatido(objetivo, "cli") : ejecutarObjetivo(objetivo, "cli"));
console.log("\n==== INFORME FINAL ====\n" + (run.informeFinal ?? run.error ?? "(sin informe)"));
console.log("\nCoste total: $" + run.costeUsd.toFixed(4));
for (const [m, t] of Object.entries(run.porModelo)) console.log("  " + m + ": " + t.calls + " llamadas, $" + t.usd.toFixed(4));
