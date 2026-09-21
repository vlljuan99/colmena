import type { ProviderName } from "../config.js";
import "../config.js"; // carga .env antes de crear clientes
import { anthropicProvider } from "./anthropic.js";
import { mockProvider } from "./mock.js";
import { openaiCompat } from "./openaiCompat.js";
import { openaiResponses } from "./openaiResponses.js";
import type { Provider } from "./types.js";

const cache = new Map<ProviderName, Provider>();

function need(envVar: string): string {
  const v = process.env[envVar];
  if (!v) throw new Error(`Falta ${envVar} en el archivo .env (copia .env.example a .env y rellénalo).`);
  return v;
}

export function getProvider(name: ProviderName): Provider {
  // COLMENA_MOCK=1 sustituye todos los proveedores por uno simulado (para probar sin claves ni gasto).
  if (process.env.COLMENA_MOCK === "1") name = "mock";
  let p = cache.get(name);
  if (p) return p;
  switch (name) {
    case "openai":
      p = openaiResponses(need("OPENAI_API_KEY"));
      break;
    case "deepseek":
      p = openaiCompat({ name: "deepseek", apiKey: need("DEEPSEEK_API_KEY"), baseURL: "https://api.deepseek.com", legacyMaxTokens: true });
      break;
    case "anthropic":
      p = anthropicProvider(need("ANTHROPIC_API_KEY"));
      break;
    case "opencode":
      // OpenCode Go ($10/mes): DeepSeek y otros modelos abiertos tras un endpoint compatible con OpenAI.
      p = openaiCompat({ name: "opencode", apiKey: need("OPENCODE_API_KEY"), baseURL: "https://opencode.ai/zen/go/v1", legacyMaxTokens: true, sessionHeader: "x-opencode-session" });
      break;
    case "mock":
      p = mockProvider();
      break;
  }
  cache.set(name, p);
  return p;
}

// Tras cambiar claves desde el panel, los clientes se recrean con la clave nueva.
export function resetProviders() { cache.clear(); }

export function providerStatus(): Record<string, boolean> {
  return {
    openai: !!process.env.OPENAI_API_KEY,
    deepseek: !!process.env.DEEPSEEK_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    opencode: !!process.env.OPENCODE_API_KEY,
  };
}
