"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("tandem", {
  // Protocol link events (tandem://auth?code=... etc.)
  onProtocolUrl: (cb) => {
    const listener = (_, url) => cb(url);
    electron.ipcRenderer.on("protocol-url", listener);
    return () => electron.ipcRenderer.removeListener("protocol-url", listener);
  },
  // Token storage via safeStorage (set in step 2)
  getToken: () => electron.ipcRenderer.invoke("token:get"),
  setToken: (token) => electron.ipcRenderer.invoke("token:set", token),
  clearToken: () => electron.ipcRenderer.invoke("token:clear"),
  // Settings
  getServerUrl: () => electron.ipcRenderer.invoke("settings:getServerUrl"),
  setServerUrl: (url) => electron.ipcRenderer.invoke("settings:setServerUrl", url),
  // Notifications
  notify: (title, body) => electron.ipcRenderer.invoke("notify", title, body),
  // Clipboard
  writeText: (text) => electron.ipcRenderer.invoke("clipboard:write", text),
  // Menu actions forwarded from main process
  onMenuAction: (cb) => {
    const listener = (_, action) => cb(action);
    electron.ipcRenderer.on("menu-action", listener);
    return () => electron.ipcRenderer.removeListener("menu-action", listener);
  }
});
