// Extrae el primer objeto JSON de una respuesta, tolerando bloques ``` y texto alrededor.
export function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("El modelo no devolvió JSON: " + text.slice(0, 200));
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}
