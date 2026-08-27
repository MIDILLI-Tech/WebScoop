import { app, shell, BrowserWindow, ipcMain, dialog, net, Tray, Menu, nativeImage } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { StateManager } from '../core/state-manager'
import { Scheduler } from '../core/scheduler'
import type { AppSettings } from '../core/types'
import { registerProjectHandlers } from './ipc/project-handlers'
import { registerCrawlHandlers, type CrawlHandlerApi } from './ipc/crawl-handlers'
import { registerScheduleHandlers } from './ipc/schedule-handlers'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let stateManager: StateManager
let scheduler: Scheduler
let crawlApi: CrawlHandlerApi | null = null
let isQuitting = false
/** Live copy of app settings, updated on every settings:update IPC. */
let currentSettings: AppSettings | null = null

function getDbPath(): string {
  return join(app.getPath('userData'), 'webscoop.db')
}

/** True when `latest` is a higher semver than `current`. */
function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string): number[] => v.split(/[.-]/).map((p) => parseInt(p, 10) || 0)
  const a = parse(latest)
  const b = parse(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

function getResourcePath(...names: string[]): string {
  // Packaged: <install>/resources (asarUnpack'ed). In dev this points at the
  // Electron binary's resources dir, so app.getAppPath() candidates run first.
  return join(process.resourcesPath, ...names)
}

function getTrayIcon(): Electron.NativeImage {
  const candidates = [
    join(app.getAppPath(), 'resources', 'webscoop-nt.png'),
    getResourcePath('webscoop-nt.png'),
    join(app.getAppPath(), 'resources', 'icon.png'),
    getResourcePath('icon.png')
  ]

  for (const iconPath of candidates) {
    const icon = nativeImage.createFromPath(iconPath)
    if (!icon.isEmpty()) {
      return icon.resize({ width: 16, height: 16 })
    }
  }

  // Fallback so tray still works even if no on-disk icon is found.
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAQAAAC1QeVaAAAAqUlEQVR4AWOgH/jPwMDA8J+BgYHhP4MDAwPDfxQYGBj+M4CJiYlhgIEB3P8ZGBgY/jOwMDCcYGBg+M/AwMBwgoGB4Q8DA8N/BgYGhhMMDAz/GRgYGP4zMDAwnGBgYPjPwMDAcIKBgeEPAwPDfwYGBoYTDMwM/xkYGBj+MzAwMJxgYGD4z8DAwHCCgYHhDwMDw38GBgaGEwwMDP8ZGNgAAHGqLQ3CyMfSAAAAAElFTkSuQmCC'
  )
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'WebScoop',
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Load the app
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Minimize to tray — uses the in-memory settings cache (kept live by the
  // settings:update IPC handler), not a fresh DB read.
  mainWindow.on('close', (event) => {
    if (!isQuitting && currentSettings?.minimizeToTray && tray) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
}

function showMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function getTrayMenu(): Electron.MenuItemConstructorOptions[] {
  const lang = stateManager?.getAppSettings().language
  const labels =
    lang === 'tr'
      ? { show: 'WebScoop\u2019u Göster', quit: 'Çıkış' }
      : { show: 'Show WebScoop', quit: 'Quit' }

  return [
    {
      label: labels.show,
      click: () => showMainWindow()
    },
    { type: 'separator' },
    {
      label: labels.quit,
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ]
}

function createTray(): void {
  try {
    const icon = getTrayIcon()
    tray = new Tray(icon)
    tray.setToolTip('WebScoop')
    tray.setContextMenu(Menu.buildFromTemplate(getTrayMenu()))

    // Windows/Linux: single left-click toggles the window (right-click opens
    // the menu above). macOS opens the menu on any click, so this never fires.
    tray.on('click', () => {
      if (mainWindow?.isVisible()) {
        mainWindow.hide()
      } else {
        showMainWindow()
      }
    })

    tray.on('double-click', () => showMainWindow())
  } catch {
    // Tray creation is optional (e.g. Linux without an indicator host),
    // skip on error — closing the window will then really close the app.
  }
}

function registerGlobalHandlers(): void {
  // Select directory dialog
  ipcMain.handle('dialog:select-directory', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Select file dialog (e.g. chrome.exe / chromium executable)
  ipcMain.handle('dialog:select-file', async (_event, filters?: Electron.FileFilter[]) => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: filters?.length ? filters : [{ name: 'All Files', extensions: ['*'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Open file in default browser
  ipcMain.handle('shell:open-in-browser', async (_event, filePath: string) => {
    await shell.openPath(filePath)
  })

  // Open containing folder
  ipcMain.handle('shell:open-in-explorer', async (_event, dirPath: string) => {
    shell.showItemInFolder(dirPath)
  })

  // Open path or URL externally (folder, file, or URL)
  ipcMain.handle('shell:open-external', async (_event, pathOrUrl: string) => {
    if (!pathOrUrl) {
      throw new Error('Cannot open: path is empty')
    }
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
      await shell.openExternal(pathOrUrl)
    } else {
      const { existsSync } = await import('node:fs')
      if (!existsSync(pathOrUrl)) {
        throw new Error(`Path does not exist: ${pathOrUrl}`)
      }
      // shell.openPath resolves with an error string on failure
      // (and with an empty path it would open "This PC" on Windows).
      const openError = await shell.openPath(pathOrUrl)
      if (openError) throw new Error(openError)
    }
  })

  // Get project file tree
  ipcMain.handle('project:get-files', async (_event, projectId: string) => {
    const project = stateManager.getProject(projectId)
    if (!project || !project.outputDir) return null
    const { existsSync } = await import('node:fs')
    if (!existsSync(project.outputDir)) return null
    const { readdir, stat } = await import('node:fs/promises')
    const { join: pjoin } = await import('node:path')

    interface TreeNode { name: string; path: string; isDir: boolean; size: number; children?: TreeNode[] }
    let totalFiles = 0
    let totalSize = 0

    async function buildTree(dirPath: string): Promise<TreeNode[]> {
      try {
        const entries = await readdir(dirPath, { withFileTypes: true })
        const items: TreeNode[] = []
        for (const entry of entries) {
          const fullPath = pjoin(dirPath, entry.name)
          if (entry.isDirectory()) {
            items.push({ name: entry.name, path: fullPath, isDir: true, size: 0, children: await buildTree(fullPath) })
          } else {
            const st = await stat(fullPath)
            totalFiles++
            totalSize += st.size
            items.push({ name: entry.name, path: fullPath, isDir: false, size: st.size })
          }
        }
        return items.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      } catch { return [] }
    }

    const tree = await buildTree(project.outputDir)
    return { tree, totalFiles, totalSize }
  })

  // Detect Chromium
  ipcMain.handle('chromium:detect', async () => {
    const { JsRenderer } = await import('../core/renderer')
    return JsRenderer.findChromiumPath()
  })

  // Update check against GitHub releases (Settings button + boot-time check)
  ipcMain.handle('update:check', async () => {
    try {
      const res = await net.fetch('https://api.github.com/repos/midilli-tech/webscoop/releases/latest', {
        headers: { 'User-Agent': 'WebScoop-Update-Check' },
        signal: AbortSignal.timeout(10_000)
      })
      if (!res.ok) return { available: false, error: `HTTP ${res.status}` }
      const data = (await res.json()) as { tag_name?: string; html_url?: string }
      const latest = String(data.tag_name || '').replace(/^v/, '')
      const current = app.getVersion()
      return {
        available: isNewerVersion(latest, current),
        current,
        latest,
        url: data.html_url || ''
      }
    } catch (err: any) {
      return { available: false, error: err?.message || String(err) }
    }
  })

  // Full update flow via electron-updater (renderer drives it from the toast)
  ipcMain.handle('update:download', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })
  ipcMain.handle('update:install', () => {
    isQuitting = true
    autoUpdater.quitAndInstall()
    return { success: true }
  })

  // Get app data path
  ipcMain.handle('app:get-user-data-path', () => {
    return app.getPath('userData')
  })

  ipcMain.handle('app:get-downloads-path', () => {
    return app.getPath('downloads')
  })
}

/** Wire electron-updater: notify → user-triggered download → install. */
function setupAutoUpdate(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  const send = (payload: Record<string, unknown>): void => {
    mainWindow?.webContents.send('update:event', payload)
  }
  autoUpdater.on('update-available', (info) => {
    send({ type: 'available', version: String(info.version ?? '') })
  })
  autoUpdater.on('download-progress', (progress) => {
    send({ type: 'progress', percent: Math.round(progress.percent ?? 0) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    send({ type: 'downloaded', version: String(info.version ?? '') })
  })
  autoUpdater.on('error', () => {
    // Expected in dev builds (no app-update.yml) and for unpublished repos.
  })

  if (currentSettings?.checkForUpdates) {
    autoUpdater.checkForUpdates().catch(() => {})
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.webscoop.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize state
  stateManager = new StateManager(getDbPath())
  scheduler = new Scheduler()
  currentSettings = stateManager.getAppSettings()

  // Crash recovery: 'crawling' can only be real while this instance runs.
  // Leftovers from a previous session mean the app was killed mid-crawl —
  // reset them so the UI never shows a phantom active download. 'paused' is
  // kept as-is: it is a legitimate user action and pending URLs stay
  // resumable from the persisted state via Start.
  for (const p of stateManager.getAllProjects()) {
    if (p.status === 'crawling') {
      stateManager.updateProject(p.id, { status: 'idle' })
    }
  }

  // Register all IPC handlers
  registerGlobalHandlers()
  registerProjectHandlers(stateManager, scheduler, (updated) => {
    currentSettings = updated
  })
  crawlApi = registerCrawlHandlers(stateManager, () => mainWindow)
  registerScheduleHandlers(stateManager, scheduler)

  createWindow()
  createTray()

  // Optionally auto-resume projects the user had paused (crash leftovers
  // were reset to 'idle' above; only explicit pauses continue here).
  if (currentSettings?.autoResumeOnLaunch) {
    for (const p of stateManager.getAllProjects()) {
      if (p.status === 'paused') {
        crawlApi.launchCrawl(p.id).catch(() => {})
      }
    }
  }

  setupAutoUpdate()

  // Restore scheduled jobs
  const projects = stateManager.getAllProjects()
  for (const p of projects) {
    if (p.schedule?.enabled) {
      scheduler.scheduleProject(p)
    }
  }

  // Handle schedule triggers
  scheduler.on('schedule-trigger', async ({ projectId }) => {
    mainWindow?.webContents.send('schedule:triggered', projectId)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  scheduler.stopAll()
  stateManager.close()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
