import { ipcMain } from 'electron'
import type { StateManager } from '../../core/state-manager'
import type { Scheduler } from '../../core/scheduler'
import type { ScheduleConfig } from '../../core/types'

export function registerScheduleHandlers(
  stateManager: StateManager,
  scheduler: Scheduler
): void {
  ipcMain.handle('schedule:set', (_event, projectId: string, config: ScheduleConfig) => {
    const project = stateManager.getProject(projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)

    stateManager.updateProject(projectId, { schedule: config })

    if (config.enabled) {
      const updated = stateManager.getProject(projectId)!
      return scheduler.scheduleProject(updated)
    } else {
      scheduler.unscheduleProject(projectId)
      return true
    }
  })

  ipcMain.handle('schedule:remove', (_event, projectId: string) => {
    scheduler.unscheduleProject(projectId)
    stateManager.updateProject(projectId, {
      schedule: { enabled: false, cron: '', incrementalOnly: false }
    })
  })

  ipcMain.handle('schedule:get-all', () => {
    return scheduler.getScheduledProjects()
  })

  ipcMain.handle('schedule:is-scheduled', (_event, projectId: string) => {
    return scheduler.isScheduled(projectId)
  })
}
