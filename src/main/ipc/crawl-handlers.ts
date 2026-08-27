import { ipcMain, app, Notification, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { StateManager } from '../../core/state-manager'
import { Crawler } from '../../core/crawler'
import { captureAuthCookies } from '../../core/auth-manager'
import type { CrawlProject, CrawlStats } from '../../core/types'

export interface CrawlHandlerApi {
  launchCrawl: (
    projectId: string
  ) => Promise<{ success: boolean; outputDir?: string; project?: CrawlProject }>
}

export function registerCrawlHandlers(
  stateManager: StateManager,
  getMainWindow: () => BrowserWindow | null
): CrawlHandlerApi {
  const activeCrawlers = new Map<string, Crawler>()

  /** Mirror crawl progress on the taskbar/dock icon. */
  function updateTaskbarProgress(stats: CrawlStats): void {
    const win = getMainWindow()
    if (!win) return
    const done = stats.filesDownloaded
    const remaining = Math.max(
      0,
      stats.totalUrls - stats.downloadedUrls - stats.failedUrls - stats.skippedUrls
    )
    const total = done + remaining
    win.setProgressBar(total > 0 ? done / total : -1)
  }

  /** OS notification when a crawl finishes while the user isn't watching. */
  function notifyComplete(projectId: string): void {
    const win = getMainWindow()
    if (win && win.isFocused() && win.isVisible()) return
    const project = stateManager.getProject(projectId)
    const tr = stateManager.getAppSettings().language === 'tr'
    const notification = new Notification({
      title: 'WebScoop',
      body: tr
        ? `İndirme tamamlandı: ${project?.name || projectId}`
        : `Download completed: ${project?.name || projectId}`
    })
    notification.on('click', () => {
      const w = getMainWindow()
      if (w) {
        if (w.isMinimized()) w.restore()
        w.show()
        w.focus()
      }
    })
    notification.show()
  }

  async function launchCrawl(
    projectId: string
  ): Promise<{ success: boolean; outputDir?: string; project?: CrawlProject }> {
    let project = stateManager.getProject(projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)

    // Validate URL
    if (!project.url) throw new Error('Project URL is empty')
    try {
      const parsed = new URL(project.url)
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only http and https URLs are supported')
      }
    } catch (e: any) {
      throw new Error(`Invalid URL: ${e.message}`, { cause: e })
    }

    // Check if already running
    if (activeCrawlers.has(projectId)) {
      throw new Error('Crawl is already running for this project')
    }

    // Auto-generate outputDir if empty
    if (!project.outputDir) {
      const sanitized = (project.name || 'project').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').toLowerCase()
      const outputDir = join(app.getPath('downloads'), sanitized)
      stateManager.updateProject(projectId, { outputDir })
      project = { ...project, outputDir }
    }

    // Apply global app-settings overrides: saved Chromium path and proxy
    const appSettings = stateManager.getAppSettings()
    const config = { ...project.config }
    if (appSettings.chromiumPath) {
      config.chromiumPath = appSettings.chromiumPath
    }
    if (appSettings.proxyEnabled && appSettings.proxyHost) {
      config.proxy = {
        host: appSettings.proxyHost,
        port: appSettings.proxyPort,
        username: appSettings.proxyUsername || undefined,
        password: appSettings.proxyPassword || undefined,
        protocol: 'http'
      }
    }
    project = { ...project, config }

    const crawler = new Crawler(project, stateManager)
    activeCrawlers.set(projectId, crawler)

    // Forward events to renderer (logs are also persisted for the Log tab)
    const mainWindow = getMainWindow()
    crawler.on('crawl-event', (event) => {
      mainWindow?.webContents.send('crawl:event', projectId, event)
      if (event.type === 'stats-update') {
        updateTaskbarProgress(event.data as CrawlStats)
      } else if (event.type === 'crawl-complete') {
        mainWindow?.setProgressBar(-1)
        notifyComplete(projectId)
      } else if (event.type === 'crawl-error') {
        mainWindow?.setProgressBar(-1)
      }
    })
    crawler.on('log', (entry) => {
      stateManager.addLog(projectId, entry)
      mainWindow?.webContents.send('crawl:log', projectId, entry)
    })

    // Start crawling (async, don't await)
    crawler.start().finally(() => {
      activeCrawlers.delete(projectId)
    })

    // Return the resolved outputDir so the renderer can update its state —
    // it may have been auto-generated just above.
    return { success: true, outputDir: project.outputDir, project }
  }

  ipcMain.handle('crawl:start', (_event, projectId: string) => launchCrawl(projectId))

  // Re-queue only the failed URLs, then the caller starts the crawl again.
  ipcMain.handle('crawl:retry-failed', (_event, projectId: string) => {
    const count = stateManager.resetFailedUrls(projectId)
    if (count > 0) {
      stateManager.updateProject(projectId, { status: 'idle' })
    }
    return { success: true, count }
  })

  ipcMain.handle('crawl:pause', (_event, projectId: string) => {
    const crawler = activeCrawlers.get(projectId)
    if (!crawler) throw new Error('No active crawl for this project')
    crawler.pause()
    return { success: true }
  })

  ipcMain.handle('crawl:resume', (_event, projectId: string) => {
    const crawler = activeCrawlers.get(projectId)
    if (!crawler) throw new Error('No active crawl for this project')
    crawler.resume()
    return { success: true }
  })

  ipcMain.handle('crawl:cancel', (_event, projectId: string) => {
    const crawler = activeCrawlers.get(projectId)
    if (!crawler) throw new Error('No active crawl for this project')
    crawler.cancel()
    return { success: true }
  })

  ipcMain.handle('crawl:set-concurrency', (_event, projectId: string, concurrency: number) => {
    const crawler = activeCrawlers.get(projectId)
    if (crawler) {
      crawler.setConcurrency(concurrency)
    }
    return { success: true }
  })

  ipcMain.handle('crawl:set-request-delay', (_event, projectId: string, delayMs: number) => {
    const crawler = activeCrawlers.get(projectId)
    if (crawler) {
      crawler.setRequestDelay(delayMs)
    }
    return { success: true }
  })

  ipcMain.handle('crawl:set-download-speed-limit', (_event, projectId: string, kbps: number) => {
    const crawler = activeCrawlers.get(projectId)
    if (crawler) {
      crawler.setDownloadSpeedLimit(kbps)
    }
    return { success: true }
  })

  ipcMain.handle('crawl:get-stats', (_event, projectId: string) => {
    const crawler = activeCrawlers.get(projectId)
    if (crawler) return crawler.getStats()
    const project = stateManager.getProject(projectId)
    return project?.stats || null
  })

  ipcMain.handle('crawl:is-running', (_event, projectId: string) => {
    return activeCrawlers.has(projectId)
  })

  // Let a freshly (re)loaded renderer re-attach to still-active crawls.
  ipcMain.handle('crawl:get-active', () => {
    return Array.from(activeCrawlers.entries()).map(([projectId, crawler]) => ({
      projectId,
      stats: crawler.getStats(),
      paused: crawler.isPaused(),
      outputDir: crawler.getOutputDir()
    }))
  })

  // Persisted logs for the Log tab (renderer seeds its in-memory buffer)
  ipcMain.handle('log:get', (_event, projectId: string) => {
    return stateManager.getLogs(projectId, stateManager.getAppSettings().maxLogEntries || 10_000)
  })

  ipcMain.handle('log:clear', (_event, projectId: string) => {
    stateManager.clearProjectLogs(projectId)
    return { success: true }
  })

  // Auth: open login window
  ipcMain.handle('auth:capture-cookies', async (_event, loginUrl: string) => {
    return captureAuthCookies(loginUrl)
  })

  return { launchCrawl }
}
