import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { StateManager } from '../../core/state-manager'
import type { Scheduler } from '../../core/scheduler'
import type { CrawlProject, AppSettings } from '../../core/types'
import { defaultCrawlConfig, defaultStats, defaultAppSettings } from '../../core/types'

export function registerProjectHandlers(
  stateManager: StateManager,
  scheduler: Scheduler,
  onSettingsChanged?: (settings: AppSettings) => void
): void {
  // Keep the live Scheduler in sync whenever a project's schedule changes.
  function syncScheduler(project: CrawlProject): void {
    if (project.schedule?.enabled && project.schedule.cron) {
      scheduler.scheduleProject(project)
    } else {
      scheduler.unscheduleProject(project.id)
    }
  }

  ipcMain.handle('project:get-all', () => {
    return stateManager.getAllProjects()
  })

  ipcMain.handle('project:get', (_event, id: string) => {
    return stateManager.getProject(id)
  })

  ipcMain.handle('project:create', (_event, data: Partial<CrawlProject>) => {
    const now = new Date().toISOString()
    const appSettings = stateManager.getAppSettings()
    const baseConfig = defaultCrawlConfig()
    const settingsConfig = {
      ...baseConfig,
      concurrency: appSettings.defaultConcurrency ?? baseConfig.concurrency,
      requestDelay: appSettings.defaultRequestDelay ?? baseConfig.requestDelay,
      downloadSpeedLimit: appSettings.defaultDownloadSpeedLimit ?? baseConfig.downloadSpeedLimit,
      userAgent: appSettings.defaultUserAgent || baseConfig.userAgent,
      respectRobotsTxt: appSettings.respectRobotsTxt ?? baseConfig.respectRobotsTxt
    }
    const project: CrawlProject = {
      id: uuidv4(),
      name: data.name || 'Untitled Project',
      url: data.url || '',
      outputDir: data.outputDir || '',
      status: 'idle',
      // Partial configs (e.g. quick-grab presets) merge over the
      // settings-aware defaults so the crawler always sees a full CrawlConfig.
      config: { ...settingsConfig, ...(data.config || {}) },
      stats: defaultStats(),
      schedule: data.schedule,
      createdAt: now,
      updatedAt: now
    }
    return stateManager.createProject(project)
  })

  ipcMain.handle('project:update', (_event, id: string, updates: Partial<CrawlProject>) => {
    stateManager.updateProject(id, updates)
    const updated = stateManager.getProject(id)
    if (updated && updates.schedule !== undefined) {
      syncScheduler(updated)
    }
    return updated
  })

  ipcMain.handle('project:delete', (_event, id: string) => {
    scheduler.unscheduleProject(id)
    stateManager.deleteProject(id)
  })

  ipcMain.handle('settings:get', () => {
    return stateManager.getAppSettings()
  })

  ipcMain.handle('settings:update', (_event, incoming: Partial<AppSettings> | undefined) => {
    // Update semantics: start from current stored settings (falling back to
    // defaults), then apply only the known keys provided in the payload.
    // A partial payload can never wipe unrelated fields.
    const base: AppSettings = stateManager.getAppSettings()
    const clean: AppSettings = { ...defaultAppSettings(), ...base }
    if (incoming && typeof incoming === 'object') {
      for (const key of Object.keys(clean) as Array<keyof AppSettings>) {
        if (key in incoming) {
          ;(clean as unknown as Record<string, unknown>)[key] = (
            incoming as unknown as Record<string, unknown>
          )[key]
        }
      }
    }
    stateManager.updateAppSettings(clean)
    onSettingsChanged?.(stateManager.getAppSettings())
    return stateManager.getAppSettings()
  })
}
