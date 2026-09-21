import type { ChatRequest, ChatResult, Provider } from "./types.js";

// Proveedor simulado: permite probar todo el flujo sin gastar nada ni tener claves.
export function mockProvider(): Provider {
  let n = 0;
  return {
    name: "mock",
    async chat(req: ChatRequest): Promise<ChatResult> {
      await new Promise((r) => setTimeout(r, 400));
      const usage = { input: 800, output: 200, cacheRead: 0 };
      const sys = req.system ?? "";
      n++;

      if (sys.includes("[ROL: planificador]")) {
        const esFinal = req.messages.some((m) => m.content.includes("INFORME FINAL"));
        if (esFinal) return { text: "Objetivo completado (simulado). Se creó hola.txt y se listó el workspace.", toolCalls: [], usage, stopReason: "stop" };
        const plan = {
          resumen: "Plan simulado en dos pasos.",
          tareas: [
            { id: "t1", titulo: "Crear archivo de saludo", categoria: "escritura", instrucciones: "Crea hola.txt con el texto hola colmena.", entregable: "hola.txt", depende_de: [] },
            { id: "t2", titulo: "Investigar alternativas", categoria: "investigacion", instrucciones: "Resume en tres líneas qué opciones hay.", entregable: "Resumen", depende_de: [] },
            { id: "t3", titulo: "Verificar workspace", categoria: "monitorizacion", instrucciones: "Lista los archivos y confirma que hola.txt existe.", entregable: "Informe de verificación", depende_de: ["t1", "t2"] },
          ],
        };
        return { text: JSON.stringify(plan), toolCalls: [], usage, stopReason: "stop" };
      }

      if (sys.includes("[ROL: entrevistador]")) {
        const turnosUsuario = req.messages.filter((m) => m.role === "user").length;
        if (turnosUsuario < 2) {
          const mensaje = ["Entendido (simulado). Dos preguntas:", "1. ¿En qué carpeta del workspace lo hacemos?", "2. ¿Cómo sabremos que está bien: tests, abrirlo en el navegador, otra cosa?"].join(String.fromCharCode(10));
          return { text: JSON.stringify({ mensaje, objetivo: null }), toolCalls: [], usage, stopReason: "stop" };
        }
        const objetivo = ["Contexto: " + req.messages[0].content, "Qué hacer: lo acordado en la entrevista.", "Entregables: archivos en el workspace.", "Criterios de éxito: se verifica como dijo el usuario.", "Restricciones: ninguna."].join(String.fromCharCode(10));
        return { text: JSON.stringify({ mensaje: "Listo: objetivo redactado (simulado).", objetivo }), toolCalls: [], usage, stopReason: "stop" };
      }

      if (sys.includes("[ROL: consultor]")) {
        const pregunta = req.messages[req.messages.length - 1].content;
        const n = (pregunta.match(/^- 20\d\d-/gm) || []).length;
        return { text: "Respuesta simulada: veo " + n + " ejecuciones en el estado. Pregunta: " + pregunta.split("PREGUNTA DEL USUARIO:").pop()?.trim().slice(0, 80), toolCalls: [], usage, stopReason: "stop" };
      }

      if (sys.includes("[ROL: revisor]")) {
        return { text: JSON.stringify({ aprobado: true, comentarios: "Correcto (simulado)." }), toolCalls: [], usage, stopReason: "stop" };
      }

      // ejecutor: la primera llamada usa una herramienta, la segunda informa.
      const yaUsoTool = req.messages.some((m) => m.role === "tool");
      if (!yaUsoTool && req.tools?.length) {
        if (req.messages.some((m) => m.content.includes("Resume en tres líneas"))) {
          await new Promise((r) => setTimeout(r, 1500));
          return { text: "Opciones (simulado): A, B y C.", toolCalls: [], usage, stopReason: "stop" };
        }
        const esT2 = req.messages.some((m) => m.content.includes("Lista los archivos"));
        const call = esT2
          ? { id: `call_${n}`, name: "list_files", args: { path: "." } }
          : { id: `call_${n}`, name: "write_file", args: { path: "hola.txt", content: "hola colmena\n" } };
        return { text: "", toolCalls: [call], usage, stopReason: "tool_calls" };
      }
      return { text: "Tarea hecha (simulado). Archivos tocados: hola.txt.", toolCalls: [], usage, stopReason: "stop" };
    },
  };
}
