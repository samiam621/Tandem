import { app, BrowserWindow, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { registerIpcHandlers } from './ipc.js'
import { buildMenu } from './menu.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── Protocol handler ─────────────────────────────────────────────────────────
// Register tandem:// scheme so the OS routes links to this app.
// On Windows in dev mode we must pass the execPath + script path.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('tandem', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('tandem')
}

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
  process.exit(0)
}

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 650,
    webPreferences: {
      // Hard rules: contextIsolation on, nodeIntegration off, sandbox on
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '../preload/index.js'),
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  })

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external links in the system browser
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// ─── Protocol link handlers ───────────────────────────────────────────────────

function handleProtocolUrl(url: string) {
  mainWindow?.webContents.send('protocol-url', url)
}

// Mac: links arrive via open-url
app.on('open-url', (_event, url) => {
  handleProtocolUrl(url)
})

// Windows: second-instance argv
app.on('second-instance', (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
  const link = argv.find((a) => a.startsWith('tandem://'))
  if (link) handleProtocolUrl(link)
})

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Windows cold-start: check argv for a tandem:// link
  const coldLink = process.argv.find((a) => a.startsWith('tandem://'))

  registerIpcHandlers()
  createWindow()
  if (mainWindow) buildMenu(mainWindow)

  if (coldLink) handleProtocolUrl(coldLink)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
