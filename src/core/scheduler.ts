import cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { EventEmitter } from 'node:events'
import type { CrawlProject, ScheduleConfig } from './types'

interface ScheduledJob {
  projectId: string
  task: ScheduledTask
  config: ScheduleConfig
}

export class Scheduler extends EventEmitter {
  private jobs = new Map<string, ScheduledJob>()

  scheduleProject(project: CrawlProject): boolean {
    if (!project.schedule?.enabled || !project.schedule?.cron) return false

    // Validate cron expression
    if (!cron.validate(project.schedule.cron)) {
      this.emit('schedule-error', {
        projectId: project.id,
        error: `Invalid cron expression: ${project.schedule.cron}`
      })
      return false
    }

    // Remove existing schedule
    this.unscheduleProject(project.id)

    const task = cron.schedule(project.schedule.cron, () => {
      this.emit('schedule-trigger', { projectId: project.id })
    })

    this.jobs.set(project.id, {
      projectId: project.id,
      task,
      config: project.schedule
    })

    return true
  }

  unscheduleProject(projectId: string): void {
    const job = this.jobs.get(projectId)
    if (job) {
      job.task.stop()
      job.task.destroy()
      this.jobs.delete(projectId)
    }
  }

  getScheduledProjects(): string[] {
    return Array.from(this.jobs.keys())
  }

  isScheduled(projectId: string): boolean {
    return this.jobs.has(projectId)
  }

  stopAll(): void {
    for (const [, job] of this.jobs) {
      job.task.stop()
      job.task.destroy()
    }
    this.jobs.clear()
  }
}
