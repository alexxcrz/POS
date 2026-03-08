const { app, BrowserWindow, Menu, shell } = require('electron')
const path = require('node:path')

app.commandLine.appendSwitch('lang', 'es-MX')

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

app.whenReady().then(() => {
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
