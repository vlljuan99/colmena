# 🐝 Colmena

Tu "empresa de IA 24/7" en local: un modelo caro **planifica y revisa**, un modelo barato **ejecuta** el 95 % del trabajo.

```
Tú das un objetivo → planificador (Astra) lo divide en tareas → ejecutor (DeepSeek Flash) las hace con
herramientas (archivos, shell, web) → revisor (Claude) aprueba o devuelve con comentarios → informe final
```

Los tres roles son independientes: cualquiera puede ser OpenAI, DeepSeek o Anthropic. Se cambia en `colmena.config.json`.

## Como programa de escritorio (recomendado)

Colmena se empaqueta como una app de Windows con Electron. Al abrirla arranca el servidor por dentro y muestra el panel en su propia ventana. Todo se configura desde el botón **⚙ Configuración** (roles, límites, precios, cron y claves API); no hay que tocar ningún archivo.

### Cómo se crea el ejecutable, paso a paso

**Requisitos** (una sola vez): [Node.js](https://nodejs.org) 20 o superior (probado con 24) y [Git](https://git-scm.com). Python no hace falta para usar la app; solo si quieres regenerar el icono.

1. **Clonar e instalar dependencias** (descarga también Electron, ~100 MB):

   ```bash
   git clone https://github.com/vlljuan99/colmena.git
   cd colmena
   npm install
   ```

2. **Generar el ejecutable**:

   ```bash
   npm run dist
   ```

   Este comando hace dos cosas: `tsc` compila TypeScript de `src/` a JavaScript en `dist/`, y `electron-builder --win` empaqueta `dist/`, `public/`, `electron/`, `colmena.config.json` y las dependencias de producción junto con el runtime de Electron. Tarda 1–3 minutos la primera vez (descarga Electron y las herramientas de empaquetado en caché) y menos las siguientes.

3. **Resultado**, en la carpeta `release/`:

   | Archivo | Qué es |
   |---|---|
   | `win-unpacked/Colmena.exe` | La app lista para ejecutar. Crea un acceso directo a este archivo. |
   | `Colmena-0.1.0-win.zip` | La misma carpeta comprimida, para llevarla a otro PC (descomprimir y ejecutar `Colmena.exe`). |
   | `Colmena Setup 0.1.0.exe` | Instalador clásico (elige carpeta, crea acceso directo en escritorio y menú Inicio, se desinstala desde Windows). |

4. **Primera ejecución**: la app crea `%APPDATA%\colmena` con la configuración por defecto, un workspace vacío y `logs/colmena.log`. Ahí es donde van tus claves API (⚙ → Claves API), el historial de ejecuciones y el workspace; nunca dentro de `release/`, así puedes regenerar el ejecutable sin perder nada.

**Cómo funciona por dentro**: `electron/main.cjs` arranca `dist/server.js` como proceso hijo usando el Node embebido en Electron (`ELECTRON_RUN_AS_NODE`), en un puerto libre, con `COLMENA_HOME` apuntando a `%APPDATA%\colmena`; cuando el servidor responde, abre una ventana con el panel. Al cerrar la ventana se cierra también el servidor.

**Para regenerar tras cambiar código**: cierra Colmena (bloquea la carpeta `release/`) y vuelve a ejecutar `npm run dist`. Si cambias `package.json → version`, el nombre de los archivos cambia con ella.

> **Smart App Control (Windows 11)**: si está activado, bloquea ejecutables sin firma de código, incluido el instalador y cualquier `.exe` modificado. Por eso el proyecto empaqueta con `signAndEditExecutable: false`: `win-unpacked/Colmena.exe` es byte a byte el binario oficial de Electron (con reputación conocida), que Windows deja ejecutar. La contrapartida es que el icono de la ventana es el de Electron y no el panal. Para tener icono propio e instalador hace falta desactivar Smart App Control (irreversible sin reinstalar Windows) o firmar el ejecutable con un certificado de código.

> **Otros sistemas**: `electron-builder` también genera paquetes para macOS (`--mac`) y Linux (`--linux`) desde esos sistemas; el código no tiene nada específico de Windows salvo el instalador.

Para probar en desarrollo sin empaquetar (compila y abre la ventana de Electron usando la carpeta del proyecto como datos):

```bash
npm run app
```

## Modo servidor (sin Electron)

```bash
npm run dev                 # panel en http://localhost:4180 (datos en la carpeta del proyecto)
```

Sin claves todavía: puedes probar todo el flujo sin gastar nada con el proveedor simulado.

```bash
set COLMENA_MOCK=1 && npm run dev
```

Desde la terminal, sin panel:

```bash
npm run goal -- "Crea un script Python que descargue el tiempo de Madrid y lo guarde en tiempo.json"
```

Comprobación rápida y barata (solo el ejecutor, sin planificar ni revisar):

```bash
npm run goal -- --latido "¿Hay tests fallando en workspace/? Resume en 3 líneas"
```

## Asistente de objetivos (entrevista previa)

Con el interruptor **"Pulir el objetivo con el asistente antes de lanzar"** activado, al pulsar *Lanzar objetivo* se abre primero una entrevista: el rol `entrevistador` te hace 1–3 preguntas por turno (puede mirar el workspace para no preguntar lo obvio), y en 2–4 turnos redacta el objetivo final con Contexto, Qué hacer, Entregables, Criterios de éxito y Restricciones. Lo puedes editar antes de lanzarlo; "Cerrar y lanzar así" corta la entrevista con lo que haya.

Modelo por defecto: `claude-sonnet-5` (buenas preguntas, buen español, una entrevista cuesta 1–2 céntimos). Cámbialo en ⚙ → Roles → entrevistador; `deepseek-flash` si prefieres coste casi cero.

## Pregunta a la colmena (chat de estado)

Pestaña **💬 Pregunta a la colmena** en la columna derecha: un chatbot con el rol `consultor` (DeepSeek Flash por defecto, céntimos por conversación) que recibe en cada turno el estado real de Colmena —configuración, gasto del mes, repositorio activo, ejecución en curso, últimas ejecuciones con sus tareas y los últimos eventos— y puede pedir el detalle completo de una ejecución o leer archivos del workspace. Sirve para "¿qué pasó con la última ejecución?", "¿dónde está el trabajo?", "¿cuánto llevo gastado?". Solo lectura.

## Presupuesto y continuar

Cada objetivo tiene un tope en USD (10 por defecto; ⚙ → Límites). Al alcanzarlo, Colmena deja de arrancar tareas, marca las interrumpidas como pendientes y detiene la ejecución con el detalle de lo hecho y lo que falta. Si el presupuesto se agota cuando ya están todas las tareas aprobadas (p. ej. redactando el informe final), la ejecución queda **terminada** con un informe automático; en cualquier caso, si push/PR están activados, lo aprobado se sube igualmente. El botón **▶ Continuar** relanza el objetivo con un resumen de lo aprobado para que el planificador solo planifique lo que falta (sirve también tras una parada manual o un error). Sube el tope antes si hace falta.

Con Claude, la caché de prompts cubre todo el historial de cada bucle (system + mensajes + resultados de herramientas), no solo el system prompt: en revisiones largas es la diferencia entre pagar cada archivo leído una vez o en cada paso.

## Obreras en paralelo

Las tareas cuyas dependencias están cumplidas se ejecutan a la vez, hasta `limites.ejecutoresParalelos` (2 por defecto; ⚙ → Límites). Cada tarea en curso es una abeja en el esquema, dentro de su equipo. La verificación (tests, revisor, commit) siempre va en serie para que dos tareas no se pisen. El planificador sabe que las tareas sin dependencias corren en paralelo y evita que toquen los mismos archivos; si un objetivo es delicado, pon el paralelismo a 1.

## Borrador de objetivo

Si existe `borrador.txt` en la carpeta de datos de Colmena, el panel lo carga en el cuadro de objetivo al abrir (y lo borra al lanzarlo). También se puede dejar por API: `PUT /api/borrador { "texto": "..." }`.

## Pruebas obligatorias y git

**Pruebas.** Tras cada tarea, Colmena ejecuta los tests del proyecto por su cuenta (no se fía del informe del ejecutor). Detecta el comando por los archivos del workspace y de sus subcarpetas de primer nivel: `package.json` con script `test` → `npm test`; `pytest.ini`/`conftest.py`/`tests` con `pyproject`/`requirements` → `python -m pytest -q`; `go.mod` → `go test ./...`; `Cargo.toml` → `cargo test`. O pon tu comando en ⚙ → Git y pruebas.
- Si fallan: la tarea vuelve al ejecutor con la salida del error, sin pasar por el revisor (cuenta como reintento).
- Si pasan: el revisor recibe el resultado real, y además puede usar `run_command` para verificar por su cuenta (ejecutar el programa, un script de comprobación).

**Git.** Panel **Repositorio** en la pantalla principal: muestra el repo activo (rama, remoto, cambios sin commit, últimos commits), permite **clonar** pegando una URL o eligiendo entre tus repos de GitHub (con `GITHUB_TOKEN`), elegir el repo activo si hay varios, y activar/desactivar rama, commit, push y PR. El planificador recibe el repo activo como contexto para no volver a clonarlo. Si el workspace (o su único proyecto de primer nivel) es un repositorio:
- al empezar un objetivo se crea la rama `colmena/<id>` desde la rama actual;
- cada tarea aprobada se commitea (`colmena(t1): título` + informe del ejecutor);
- al terminar, opcionalmente `push` a `origin` y **pull request** en GitHub con el informe final como descripción (necesita `GITHUB_TOKEN` con permiso `repo`/`pull_requests: write`; el push usa tus credenciales de git habituales, p. ej. Git Credential Manager).

Todo esto es determinista (lo hace Colmena, no la IA), y al ejecutor se le dice que no haga commits ni cambie de rama. Para trabajar sobre un repo existente, clónalo dentro de `workspace/` (o apunta el workspace a él en ⚙ → Roles → carpeta workspace).

## Dónde sacar las claves

| Proveedor | Variable | Dónde |
|---|---|---|
| OpenAI (GPT-6 Astra) | `OPENAI_API_KEY` | https://platform.openai.com/api-keys |
| DeepSeek (V4.1 Flash) | `DEEPSEEK_API_KEY` | https://platform.deepseek.com/api_keys |
| Anthropic (Claude) | `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys |
| OpenCode Go (DeepSeek y otros abiertos, $10/mes) | `OPENCODE_API_KEY` | https://opencode.ai/go |
| GitHub (solo para abrir PRs) | `GITHUB_TOKEN` | https://github.com/settings/tokens |

Se pegan en **⚙ Configuración → Claves API** (se guardan en un `.env` local). Un rol cuyo proveedor no tenga clave falla con un mensaje claro; los demás no se ven afectados.

## Configuración (⚙ en el panel, o `colmena.config.json`)

- **roles**: `planificador`, `ejecutor`, `revisor`, `entrevistador` → `{ provider, model, effort? }`. Proveedores: `openai`, `deepseek`, `anthropic`, `opencode`.
  Ejemplos: revisor con `claude-sonnet-5` para abaratar; todo en `deepseek` para pruebas; planificador en `claude-opus-5`.
- **limites**: tareas por objetivo, pasos por tarea, reintentos tras rechazo del revisor, **tope de coste en USD por objetivo** (aborta si se supera), timeout de comandos, umbral de **compactación** de contexto, **ejecutores en paralelo**.
- **precios**: $/millón de tokens por modelo. DeepSeek tiene tarifa fuera de hora punta (`offPeak` + `peakHoursUTC`); ajústalo si cambia.
- **cron**: objetivos que se lanzan solos. Pon `"activo": true` y una expresión cron (`"0 8 * * *"` = todos los días a las 8). `"modo": "latido"` para comprobaciones baratas (solo ejecutor); `"objetivo"` para el flujo completo.
- **workspace**: carpeta donde trabaja el ejecutor. Todas las herramientas están confinadas a ella.

## Reglas de ahorro (del hilo de @sairahul1)

Colmena aplica las ideas del hilo "24/7 AI company for $50/month", traducidas a una app propia en vez de Codex + codex-router:

| Idea del hilo | Cómo está en Colmena |
|---|---|
| "Astra piensa, Flash ejecuta"; delegación explícita | Prompt del planificador: delega TODA la implementación, se queda solo con arquitectura, seguridad y QA |
| `reasoning_effort = low` para Astra | `effort` por rol en la config (`low` en planificador, `medium` en revisor). OpenAI → `reasoning_effort`, Claude → `output_config.effort` |
| Heartbeats y cron en Flash, nunca en el modelo caro | Modo **latido**: cron con `"modo": "latido"`, botón *Latido* en el panel, `npm run goal -- --latido "..."`. Va directo al ejecutor, sin planificar ni revisar |
| No romper la caché de prompts (sin timestamps ni ids en el prefijo) | Los system prompts son constantes; todo lo variable va en el mensaje de usuario. Claude lleva `cache_control` explícito. El panel muestra tokens servidos desde caché |
| Contexto sin bloat (AGENTS.md < 800 tokens) | `workspace/AGENTS.md` opcional con reglas del proyecto; aviso al arrancar si supera ~800 tokens |
| Precipicio de precio de Astra (> 272K tokens de entrada → $20/$75) | Modelado en `precios.gpt-6-astra.cliff`; aviso en el registro si una llamada lo cruza |
| DeepSeek fuera de punta = todo menos lun–vie 01–04 y 06–10 UTC | `peakHoursUTC` + `peakDaysUTC` en la config |
| Contenido recuperado = datos, no instrucciones | Regla en los tres prompts; el revisor vigila que el ejecutor no obedezca a archivos o webs |
| Compactación de contexto (`experimental_mode` de Codex) | Automática en el bucle del agente: al superar `compactarTokens` (120K por defecto) se vacían resultados antiguos de herramientas y, si sigue grande, el modelo resume su propio progreso y continúa con contexto limpio |
| OpenCode Go ($10/mes con DeepSeek V4.1 Flash incluido) | Proveedor `opencode` (endpoint compatible con OpenAI, cabecera de sesión `x-opencode-session`). Modelo: `deepseek-v4.1-flash`. Clave en ⚙ → Claves API |

Lo que el hilo hace con ChatGPT Plus + Codex (Astra a precio fijo de $20/mes) no se puede replicar por API: aquí Astra se paga por token. Si el planificador te sale caro, bájalo a `claude-sonnet-5` o pon `effort: "low"` (ya viene así).

## Herramientas del ejecutor

`list_files`, `read_file`, `write_file`, `run_command` (shell dentro del workspace, con timeout) y `fetch_url`.
El planificador y el revisor solo pueden leer.

> ⚠️ `run_command` ejecuta comandos reales en tu PC (dentro de `workspace/`). Es lo que hace útil a la colmena,
> pero no le des objetivos que no le darías a un becario con acceso a esa carpeta.

## Estructura

```
electron/main.cjs  ventana de escritorio: lanza el servidor como proceso hijo y abre el panel
src/
  config.ts        carga/guarda .env y colmena.config.json (recarga en caliente)
  providers/       adaptadores: openaiResponses (OpenAI/Astra), openaiCompat (DeepSeek, OpenCode Go), anthropic, mock
  tools.ts         herramientas del ejecutor
  agent.ts         bucle genérico: modelo ↔ herramientas
  orchestrator.ts  plan → ejecutar → revisar → informe
  cost.ts          tokens → USD por modelo
  server.ts        API HTTP + SSE + panel
  scheduler.ts     cron
  cli.ts           uso desde terminal
public/index.html  panel web
data/runs/         historial de ejecuciones (JSON)
workspace/         donde trabaja la colmena
```
