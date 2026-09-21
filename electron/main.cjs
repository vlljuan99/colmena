// Proceso principal de Electron: arranca el servidor de Colmena como proceso hijo (Node embebido)
// y abre una ventana con el panel. Los datos (config, claves, historial, workspace) viven en userData.
const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SERVER = path.join(ROOT, "dist", "server.js");

let child = null;
let win = null;

function puertoLibre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const port = s.address().port; s.close(() => resolve(port)); });
    s.on("error", reject);
  });
}

function esperarServidor(port, timeoutMs = 30000) {
  const inicio = Date.now();
  return new Promise((resolve, reject) => {
    const intento = () => {
      http.get("http://127.0.0.1:" + port + "/api/state", (res) => { res.resume(); res.statusCode === 200 ? resolve() : retry(); })
        .on("error", retry);
    };
    const retry = () => Date.now() - inicio > timeoutMs ? reject(new Error("El servidor no arrancó a tiempo")) : setTimeout(intento, 300);
    intento();
  });
}

async function arrancarServidor() {
  const home = app.isPackaged ? app.getPath("userData") : ROOT;
  fs.mkdirSync(path.join(home, "logs"), { recursive: true });
  const log = fs.createWriteStream(path.join(home, "logs", "colmena.log"), { flags: "a" });
  const port = await puertoLibre();

  child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", COLMENA_HOME: home, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.pipe(log); child.stderr.pipe(log);
  child.on("exit", (code) => {
    child = null;
    if (win && !app.isQuitting) {
      dialog.showErrorBox("Colmena", "El servidor interno se ha cerrado (código " + code + "). Revisa logs/colmena.log en " + home);
      app.quit();
    }
  });
  await esperarServidor(port);
  return port;
}

function crearVentana(port) {
  win = new BrowserWindow({
    width: 1320, height: 880, minWidth: 900, minHeight: 600,
    title: "Colmena", backgroundColor: "#0f1115", autoHideMenuBar: true,
    icon: path.join(ROOT, "build", "icon.png"),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.loadURL("http://127.0.0.1:" + port);
  // Enlaces externos (documentación de claves) se abren en el navegador del sistema.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.on("closed", () => { win = null; });
}

app.whenReady().then(async () => {
  try {
    const port = await arrancarServidor();
    crearVentana(port);
  } catch (e) {
    dialog.showErrorBox("Colmena", "No se pudo arrancar: " + e.message);
    app.quit();
  }
});

app.on("before-quit", () => { app.isQuitting = true; if (child) child.kill(); });
app.on("window-all-closed", () => app.quit());
