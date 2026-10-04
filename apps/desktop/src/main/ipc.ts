import { ipcMain, safeStorage, Notification, clipboard } from 'electron'
import Store from 'electron-store'

interface StoreSchema {
  tokenCiphertext: string | undefined
  serverUrl: string | undefined
}

const store = new Store<StoreSchema>()

const DEFAULT_SERVER_URL = 'http://localhost:3000'

export function registerIpcHandlers() {
  // ─── Token storage (safeStorage → OS keychain) ─────────────────────────────
  ipcMain.handle('token:get', () => {
    const ciphertext = store.get('tokenCiphertext')
    if (!ciphertext) return null
    try {
      return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'))
    } catch {
      return null
    }
  })

  ipcMain.handle('token:set', (_event, token: string) => {
    const encrypted = safeStorage.encryptString(token)
    store.set('tokenCiphertext', encrypted.toString('base64'))
  })

  ipcMain.handle('token:clear', () => {
    store.delete('tokenCiphertext')
  })

  // ─── Settings ──────────────────────────────────────────────────────────────
  ipcMain.handle('settings:getServerUrl', () => {
    return store.get('serverUrl') ?? DEFAULT_SERVER_URL
  })

  ipcMain.handle('settings:setServerUrl', (_event, url: string) => {
    store.set('serverUrl', url)
  })

  // ─── Notifications ─────────────────────────────────────────────────────────
  ipcMain.handle('notify', (_event, title: string, body: string) => {
    new Notification({ title, body }).show()
  })

  // ─── Clipboard ─────────────────────────────────────────────────────────────
  ipcMain.handle('clipboard:write', (_event, text: string) => {
    clipboard.writeText(text)
  })
}
