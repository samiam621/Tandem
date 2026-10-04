import { contextBridge, ipcRenderer } from 'electron'

// The only surface the renderer has to the main process.
// Keep this minimal and typed.

contextBridge.exposeInMainWorld('tandem', {
  // Protocol link events (tandem://auth?code=... etc.)
  onProtocolUrl: (cb: (url: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, url: string) => cb(url)
    ipcRenderer.on('protocol-url', listener)
    return () => ipcRenderer.removeListener('protocol-url', listener)
  },

  // Token storage via safeStorage (set in step 2)
  getToken: (): Promise<string | null> => ipcRenderer.invoke('token:get'),
  setToken: (token: string): Promise<void> => ipcRenderer.invoke('token:set', token),
  clearToken: (): Promise<void> => ipcRenderer.invoke('token:clear'),

  // Settings
  getServerUrl: (): Promise<string> => ipcRenderer.invoke('settings:getServerUrl'),
  setServerUrl: (url: string): Promise<void> => ipcRenderer.invoke('settings:setServerUrl', url),

  // Notifications
  notify: (title: string, body: string): Promise<void> =>
    ipcRenderer.invoke('notify', title, body),

  // Clipboard
  writeText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),

  // Menu actions forwarded from main process
  onMenuAction: (cb: (action: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, action: string) => cb(action)
    ipcRenderer.on('menu-action', listener)
    return () => ipcRenderer.removeListener('menu-action', listener)
  },
})
