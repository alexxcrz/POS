const { app, BrowserWindow, Menu, shell } = require('electron')
const { spawn } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')

app.commandLine.appendSwitch('lang', 'es-MX')

let backendProcess = null

function checkBackendHealth() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:8787/api/health', (res) => {
      res.resume()
      resolve(res.statusCode >= 200 && res.statusCode < 300)
    })

    req.on('error', () => resolve(false))
    req.setTimeout(1000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitForBackendReady(timeoutMs = 12000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const ok = await checkBackendHealth()
    if (ok) return true
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return false
}

async function ensureBackendRunning() {
  const alreadyUp = await checkBackendHealth()
  if (alreadyUp) return true

  const backendEntry = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'index.js')
    : path.join(__dirname, '..', 'backend', 'index.js')
  const backendRoot = path.dirname(backendEntry)
  const dataDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'backend-data')
    : path.join(backendRoot, 'data')

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    POS_DATA_DIR: dataDir,
  }

  backendProcess = spawn(process.execPath, [backendEntry], {
    cwd: backendRoot,
    env,
    stdio: 'ignore',
    windowsHide: true,
  })

  backendProcess.on('exit', () => {
    backendProcess = null
  })

  return waitForBackendReady()
}

function stopBackendProcess() {
  if (!backendProcess) return
  try {
    backendProcess.kill()
  } catch {
    // Ignore process kill errors during app shutdown.
  }
  backendProcess = null
}

function createMainWindow() {
  const iconPath = path.join(__dirname, 'assets', 'pos-icon.ico')

  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  })

  try {
    win.webContents.session.setSpellCheckerLanguages(['es-MX', 'es'])
  } catch {
    // Keep running if spellchecker languages are not available.
  }

  Menu.setApplicationMenu(null)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url.startsWith('data:text/html')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          icon: iconPath,
          width: 420,
          height: 640,
          webPreferences: {
            contextIsolation: true,
            sandbox: true,
            spellcheck: true,
          },
        },
      }
    }

    if (/^(https?:|mailto:)/i.test(url)) {
      shell.openExternal(url)
    }

    return { action: 'deny' }
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    const message = [
      '<h2>No se pudo cargar la aplicacion.</h2>',
      '<p>Verifica que el build exista y vuelve a abrir el sistema.</p>',
      `<p><strong>Error:</strong> ${errorCode} - ${errorDescription}</p>`,
      `<p><strong>URL:</strong> ${validatedURL || 'N/A'}</p>`,
    ].join('')

    win.loadURL(`data:text/html,${encodeURIComponent(message)}`)
  })

  const indexPath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html')
  win.loadFile(indexPath).catch((error) => {
    const message = [
      '<h2>Error al abrir el sistema.</h2>',
      '<p>No fue posible abrir el archivo principal.</p>',
      `<pre>${String(error)}</pre>`,
    ].join('')

    win.loadURL(`data:text/html,${encodeURIComponent(message)}`)
  })

  win.once('ready-to-show', () => {
    win.show()
  })
}

app.whenReady().then(async () => {
  await ensureBackendRunning()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  stopBackendProcess()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopBackendProcess()
})
