"use strict";
const electron = require("electron");
const path = require("path");
const url = require("url");
const Store = require("electron-store");
const store = new Store();
const DEFAULT_SERVER_URL = "http://localhost:3000";
function registerIpcHandlers() {
  electron.ipcMain.handle("token:get", () => {
    const ciphertext = store.get("tokenCiphertext");
    if (!ciphertext) return null;
    try {
      return electron.safeStorage.decryptString(Buffer.from(ciphertext, "base64"));
    } catch {
      return null;
    }
  });
  electron.ipcMain.handle("token:set", (_event, token) => {
    const encrypted = electron.safeStorage.encryptString(token);
    store.set("tokenCiphertext", encrypted.toString("base64"));
  });
  electron.ipcMain.handle("token:clear", () => {
    store.delete("tokenCiphertext");
  });
  electron.ipcMain.handle("settings:getServerUrl", () => {
    return store.get("serverUrl") ?? DEFAULT_SERVER_URL;
  });
  electron.ipcMain.handle("settings:setServerUrl", (_event, url2) => {
    store.set("serverUrl", url2);
  });
  electron.ipcMain.handle("notify", (_event, title, body) => {
    new electron.Notification({ title, body }).show();
  });
  electron.ipcMain.handle("clipboard:write", (_event, text) => {
    electron.clipboard.writeText(text);
  });
}
function buildMenu(mainWindow2) {
  const isMac = process.platform === "darwin";
  const template = [
    // App menu (macOS only)
    ...isMac ? [{
      label: electron.app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    }] : [],
    // File
    {
      label: "File",
      submenu: [
        {
          label: "New Session",
          accelerator: "CmdOrCtrl+N",
          click: () => mainWindow2.webContents.send("menu-action", "new-session")
        },
        {
          label: "Join Session…",
          accelerator: "CmdOrCtrl+J",
          click: () => mainWindow2.webContents.send("menu-action", "join-session")
        },
        { type: "separator" },
        {
          label: "Settings",
          accelerator: "CmdOrCtrl+,",
          click: () => mainWindow2.webContents.send("menu-action", "settings")
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" }
      ]
    },
    // Edit
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    // View
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...process.env.NODE_ENV === "development" ? [{ role: "toggleDevTools" }] : []
      ]
    }
  ];
  electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(template));
}
const __dirname$1 = path.dirname(url.fileURLToPath(require("url").pathToFileURL(__filename).href));
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    electron.app.setAsDefaultProtocolClient("tandem", process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  electron.app.setAsDefaultProtocolClient("tandem");
}
const singleInstance = electron.app.requestSingleInstanceLock();
if (!singleInstance) {
  electron.app.quit();
  process.exit(0);
}
let mainWindow = null;
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1e3,
    minHeight: 650,
    webPreferences: {
      // Hard rules: contextIsolation on, nodeIntegration off, sandbox on
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname$1, "../preload/index.js")
    },
    titleBarStyle: "hiddenInset",
    show: false
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname$1, "../renderer/index.html"));
  }
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url: url2 }) => {
    electron.shell.openExternal(url2);
    return { action: "deny" };
  });
}
function handleProtocolUrl(url2) {
  mainWindow?.webContents.send("protocol-url", url2);
}
electron.app.on("open-url", (_event, url2) => {
  handleProtocolUrl(url2);
});
electron.app.on("second-instance", (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  const link = argv.find((a) => a.startsWith("tandem://"));
  if (link) handleProtocolUrl(link);
});
electron.app.whenReady().then(() => {
  const coldLink = process.argv.find((a) => a.startsWith("tandem://"));
  registerIpcHandlers();
  createWindow();
  if (mainWindow) buildMenu(mainWindow);
  if (coldLink) handleProtocolUrl(coldLink);
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
