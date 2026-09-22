# 🐝 Colmena — Manual para early adopters

Colmena es una app de escritorio que convierte un objetivo escrito en lenguaje natural en trabajo hecho en tu PC: un modelo de IA **planifica**, varios modelos baratos **ejecutan** en paralelo (código, investigación, escritura, datos), se **ejecutan los tests** de tu proyecto, un **revisor** aprueba, y todo queda en **commits de git**. Tú pones las claves de API y pagas solo lo que consumes (normalmente céntimos por objetivo pequeño, uno o dos dólares por uno grande).

Esta guía asume que nunca has abierto Colmena. Tiempo estimado hasta el primer objetivo: 15 minutos.

---

## 1. Qué necesitas

- **Windows 10/11** (64 bits). En macOS/Linux funciona el modo servidor (ver §9).
- **Git** instalado ([git-scm.com](https://git-scm.com)) si quieres que Colmena trabaje sobre repositorios (recomendado).
- **Al menos una clave de API** de un proveedor de modelos. Recomendación para empezar barato: **DeepSeek** (platform.deepseek.com, ~$5 de saldo dan para mucho). Opcional: OpenAI (GPT-6 Astra como planificador), Anthropic (Claude para entrevistas/revisión), OpenCode Go ($10/mes con DeepSeek incluido).
- Opcional: un **token de GitHub** (github.com/settings/tokens, permiso `repo`) para clonar repos privados desde la app y abrir pull requests.

> Sin claves puedes abrir la app y ver la interfaz, pero no ejecutar objetivos.

---

## 2. Instalación

1. Descarga `Colmena-<versión>-win.zip` de la página de **Releases** del repositorio.
2. Descomprímelo donde quieras (p. ej. `C:\Colmena`).
3. Ejecuta `Colmena.exe`. Crea un acceso directo en el escritorio si te apetece.

**Si Windows lo bloquea ("Una directiva de Control de aplicaciones bloqueó este archivo")**: tienes Smart App Control activado. Usa el zip, no el instalador `Colmena Setup.exe`: el `Colmena.exe` del zip es el binario oficial de Electron sin modificar y Windows lo deja pasar. (Por eso el icono de la ventana es el de Electron.)

Al abrirse, Colmena arranca un servidor local por dentro y muestra el panel en su ventana. No abre puertos hacia fuera: escucha solo en `127.0.0.1`.

Todos tus datos (configuración, claves, historial, workspace, logs) viven en `%APPDATA%\colmena`. Puedes borrar y reinstalar la app sin perderlos.

---

## 3. Primer arranque: claves y roles (5 minutos)

Pulsa **⚙ Configuración** (arriba a la derecha).

### Pestaña Claves API
Pega las claves que tengas y **Guardar claves**. Se guardan en un archivo `.env` local; no salen de tu PC salvo hacia el proveedor correspondiente. Al lado de cada una verás ✔ configurada.

### Pestaña Roles
Colmena tiene cinco roles. Cada uno puede usar un proveedor y modelo distintos:

| Rol | Qué hace | Recomendación barata | Recomendación "calidad" |
|---|---|---|---|
| **planificador** | Lee tu objetivo, lo divide en tareas, redacta el informe final | `deepseek` / `deepseek-flash` | `openai` / `gpt-6-astra` (effort `low`) |
| **ejecutor** | Hace las tareas con herramientas (archivos, shell, web) | `deepseek` / `deepseek-flash` | igual: es donde más tokens se gastan |
| **revisor** | Comprueba cada tarea tras los tests | `deepseek` / `deepseek-flash` | `anthropic` / `claude-sonnet-5` |
| **entrevistador** | Te hace preguntas para convertir una idea vaga en un objetivo claro | `deepseek` / `deepseek-flash` | `anthropic` / `claude-sonnet-5` |
| **consultor** | Chatbot de estado ("¿qué ha pasado?") | `deepseek` / `deepseek-flash` | igual |

Si solo tienes clave de DeepSeek: pon **todo** en `deepseek` / `deepseek-flash` y funciona (calidad de planificación algo menor, coste mínimo).

Los chips de la cabecera muestran el modelo de cada rol; un punto rojo significa que falta la clave de ese proveedor.

### Pestaña Límites
- **Tope de coste por objetivo (USD)**: al llegar, Colmena se detiene sin perder nada (ver §7). Para empezar, 2–5 $.
- **Ejecutores en paralelo**: 2 está bien. Ponlo a 1 si el proyecto es delicado.
- El resto puedes dejarlo por defecto.

Pulsa **Guardar configuración**. Se aplica al momento.

---

## 4. Tu primer objetivo (10 minutos)

Empieza con algo pequeño y autocontenido, por ejemplo:

> Crea en la carpeta `hola/` del workspace una página web estática con un título, un párrafo sobre las abejas y un CSS propio con tema oscuro. Verifica que el HTML es válido abriéndolo con un comando.

1. Escríbelo en **Nuevo objetivo**.
2. Deja activado **"Pulir el objetivo con el asistente antes de lanzar"** la primera vez: el entrevistador te hará 2–3 preguntas por turno (cada pregunta tiene su propio cuadro de respuesta) y en un par de turnos te propone el objetivo final con Contexto / Qué hacer / Entregables / Criterios de éxito / Restricciones. Pulsa **🚀 Lanzar este objetivo**. Si tienes prisa, **Cerrar y lanzar** le pide que lo redacte con lo que haya.
3. Mira **Colmena en vivo**: Astra (el planificador) pulsa mientras planifica; luego las abejas aparecen en su equipo (Código, Investigación, Escritura, Datos, Monitorización); la barra de flujo avanza (planifica → ejecuta → revisa → resultados); abajo, la línea de estado muestra tokens y coste acumulado.
4. Cuando termine, en **Ejecución** verás cada tarea con el informe del ejecutor y el comentario del revisor, el **Informe final** y la tabla **Coste por modelo**.

Un objetivo así cuesta 1–5 céntimos con DeepSeek.

---

## 5. Trabajar sobre un repositorio (lo habitual)

Panel **Repositorio** (columna izquierda):

1. Despliega **＋ Añadir un repositorio al workspace**. Pega la URL de GitHub (o `usuario/repo`) y **Clonar**; con token de GitHub puedes pulsar **Cargar** y elegir entre tus repos, privados incluidos.
2. El repo queda como **activo**: verás rama, remoto, cambios sin commit y últimos commits. Si tienes varios, un selector te deja cambiar.
3. Interruptores:
   - **rama por objetivo**: cada objetivo trabaja en `colmena/<id>` (recomendado: tu `main` no se toca).
   - **commit por tarea**: cada tarea aprobada se commitea con su informe.
   - **push al terminar** y **abrir pull request**: sube la rama y abre la PR con el informe final (la PR necesita token).
4. Escribe el objetivo hablando del repo como algo que ya existe ("en `src/api/`, añade…"). El planificador sabe qué repo hay y no lo vuelve a clonar.

**Tests obligatorios**: tras cada tarea, Colmena detecta los tests del proyecto (`npm test`, `pytest`, `go test`, `cargo test`; también en subcarpetas como `repo/servicio/`) y los ejecuta. Si fallan, la tarea vuelve al ejecutor con el error; el revisor solo entra cuando pasan. Puedes fijar un comando propio en ⚙ → Git y pruebas.

Si una ejecución acaba con tareas hechas pero sin push (por ejemplo tenías push apagado), el trabajo sigue en la rama `colmena/…` dentro de `%APPDATA%\colmena\workspace\<repo>`. Activa push y pulsa **▶ Continuar**, o haz `git push` a mano desde esa carpeta.

---

## 6. Las otras formas de lanzar trabajo

- **Latido**: el botón junto a "Lanzar objetivo". Va directo al ejecutor barato, sin planificar ni revisar. Para comprobaciones rutinarias: "¿Hay tests fallando? Resume en 3 líneas". Cuesta décimas de céntimo.
- **Cron** (⚙ → Cron): objetivos o latidos que se lanzan solos con una expresión cron (`0 * * * *` = cada hora). Colmena debe estar abierta.
- **💬 Pregunta a la colmena** (pestaña junto a Ejecución): chatbot con el estado real de todo —ejecuciones, tareas, costes, ramas, archivos—. Solo lee; no lanza nada. "¿Qué quedó pendiente ayer?", "¿cuánto llevo este mes?", "¿en qué rama está lo de la API?".

---

## 7. Cuando algo se para: presupuesto, errores, continuar

- **Presupuesto agotado**: la ejecución se detiene; las tareas aprobadas quedan commiteadas y las interrumpidas marcadas como pendientes (puede haber trabajo parcial en el workspace). Sube el tope en ⚙ → Límites y pulsa **▶ Continuar** en esa ejecución: el planificador recibe qué está hecho y planifica **solo lo que falta**. Si el presupuesto se agotó cuando ya estaban todas las tareas aprobadas, la ejecución cuenta como terminada.
- **Detener**: para la ejecución en curso al terminar la llamada actual. Luego puedes Continuar.
- **↺ Reutilizar objetivo**: vuelve a poner el texto del objetivo en el cuadro para editarlo y relanzar.
- **Error de API** (clave inválida, modelo inexistente): aparece en rojo en la ejecución; arréglalo en ⚙ y relanza.

---

## 8. Entender los costes

- La tabla **Coste por modelo** de cada ejecución muestra llamadas, tokens de entrada, tokens servidos desde **caché** (mucho más baratos), salida y USD.
- El ejecutor hace el 90 % de las llamadas: ponlo en un modelo barato. DeepSeek cachea automáticamente; con Claude, Colmena activa la caché de todo el historial.
- Los precios están en ⚙ → Precios (por millón de tokens); ajústalos si tu proveedor cambia tarifas. DeepSeek es más barato fuera de hora punta (lun–vie 01–04 y 06–10 UTC) y Colmena lo tiene en cuenta.
- "Este mes" en Colmena en vivo suma todas las ejecuciones del mes.
- Orientativo con DeepSeek en todo: objetivo pequeño 0,02–0,10 $; añadir una funcionalidad con tests a un repo real 0,3–1,5 $. Con GPT-6 Astra de planificador, súmale 0,2–0,4 $ por objetivo.

---

## 9. Modo servidor (sin la app de escritorio, o en macOS/Linux)

```bash
git clone https://github.com/vlljuan99/colmena.git
cd colmena
npm install
npm run dev          # panel en http://localhost:4180; datos en la carpeta del proyecto
```

Sin claves, prueba todo el flujo con el proveedor simulado: `COLMENA_MOCK=1 npm run dev`. Desde terminal: `npm run goal -- "objetivo"` o `npm run goal -- --latido "comprobación"`.

Para generar tú mismo el ejecutable de Windows: `npm run dist` (ver README).

---

## 10. Seguridad: qué puede hacer Colmena en tu PC

- El ejecutor tiene `run_command`: **ejecuta comandos reales**, confinados a la carpeta `workspace`. Es lo que le permite instalar dependencias, correr tests o clonar. No le des objetivos que no le darías a una persona con acceso a esa carpeta, y no pongas ahí nada que no quieras que toque.
- Las rutas de archivos están confinadas al workspace; el revisor y el planificador solo leen.
- Todo lo que las IAs leen de archivos o webs se trata como datos, no como instrucciones (los prompts lo dicen explícitamente), pero un modelo barato puede equivocarse: revisa las PRs antes de fusionar.
- Las claves solo viajan a su proveedor. El servidor local no acepta conexiones externas.

---

## 11. Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| Windows bloquea `Colmena.exe` o el instalador | Smart App Control. Usa el `Colmena.exe` del zip (no el Setup). |
| "Falta OPENAI_API_KEY…" al lanzar | Un rol usa un proveedor sin clave. ⚙ → Claves API, o cambia el rol a otro proveedor. |
| `400 … reasoning_effort` con OpenAI | Actualiza Colmena: las versiones actuales usan la API Responses. |
| El planificador vuelve a clonar el repo | Asegúrate de que el repo está **activo** en el panel Repositorio antes de lanzar. |
| Tests "PASAN" pero no son los del servicio que tocas | Colmena busca tests hasta 3 niveles; si tu proyecto está más profundo, fija el comando en ⚙ → Git y pruebas. |
| El coste se dispara | Revisa qué modelo está en `revisor` y `ejecutor` (deben ser baratos), baja el tope, y mira la columna Caché: si es 0 con Claude, actualiza Colmena. |
| Cambié la config editando el JSON y no se aplica | Usa siempre ⚙ dentro de la app. Si editas el archivo a mano, hazlo con la app cerrada. |
| Quiero empezar de cero | Cierra Colmena y borra `%APPDATA%\colmena` (perderás historial, claves y workspace). |

Los logs están en `%APPDATA%\colmena\logs\colmena.log`; la primera línea de cada arranque dice qué config y qué roles ha cargado.

---

## 12. Glosario rápido

- **Objetivo**: lo que pides. Se convierte en una **ejecución** con varias **tareas**.
- **Obrera**: un ejecutor trabajando en una tarea; en el esquema, una abeja.
- **Latido**: una tarea suelta, sin planificar ni revisar.
- **Workspace**: la carpeta donde trabaja Colmena (`%APPDATA%\colmena\workspace`), con tus repos dentro.
- **Rama colmena/…**: donde queda el trabajo de cada objetivo.
- **Continuar**: relanzar una ejecución detenida sin repetir lo aprobado.

¿Algo no cuadra con lo que ves en pantalla? Abre un issue en el repositorio con la captura y el fragmento de `logs/colmena.log`.
