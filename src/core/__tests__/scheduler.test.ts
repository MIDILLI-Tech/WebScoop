import { describe, it, expect, vi, afterEach } from 'vitest'
import { Scheduler } from '../scheduler'
import { defaultCrawlConfig, defaultStats, type CrawlProject } from '../types'

function makeProject(id: string, schedule?: { enabled: boolean; cron: string; incrementalOnly: boolean }): CrawlProject {
  const now = new Date().toISOString()
  return {
    id,
    name: `Project ${id}`,
    url: 'https://example.com/',
    outputDir: '/tmp/x',
    status: 'idle',
    config: defaultCrawlConfig(),
    stats: defaultStats(),
    schedule,
    createdAt: now,
    updatedAt: now
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Scheduler', () => {
  it('schedules a project with a valid cron expression', () => {
    const s = new Scheduler()
    expect(s.scheduleProject(makeProject('p1', { enabled: true, cron: '0 2 * * *', incrementalOnly: false }))).toBe(true)
    expect(s.isScheduled('p1')).toBe(true)
    expect(s.getScheduledProjects()).toEqual(['p1'])
    s.stopAll()
  })

  it('rejects disabled or cron-less schedules', () => {
    const s = new Scheduler()
    expect(s.scheduleProject(makeProject('p1'))).toBe(false)
    expect(s.scheduleProject(makeProject('p2', { enabled: false, cron: '0 2 * * *', incrementalOnly: false }))).toBe(false)
    expect(s.scheduleProject(makeProject('p3', { enabled: true, cron: '', incrementalOnly: false }))).toBe(false)
    expect(s.isScheduled('p1')).toBe(false)
    s.stopAll()
  })

  it('emits schedule-error for invalid cron expressions', () => {
    const s = new Scheduler()
    const onError = vi.fn()
    s.on('schedule-error', onError)

    expect(s.scheduleProject(makeProject('p1', { enabled: true, cron: 'not-a-cron', incrementalOnly: false }))).toBe(false)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toMatchObject({ projectId: 'p1' })
    expect(s.isScheduled('p1')).toBe(false)
    s.stopAll()
  })

  it('reschedules cleanly (old task replaced)', () => {
    const s = new Scheduler()
    const sched = { enabled: true, cron: '0 2 * * *', incrementalOnly: false }
    expect(s.scheduleProject(makeProject('p1', sched))).toBe(true)
    expect(s.scheduleProject(makeProject('p1', { ...sched, cron: '0 3 * * *' }))).toBe(true)
    expect(s.getScheduledProjects()).toEqual(['p1']) // no duplicates
    s.stopAll()
  })

  it('unscheduleProject removes the job', () => {
    const s = new Scheduler()
    s.scheduleProject(makeProject('p1', { enabled: true, cron: '0 2 * * *', incrementalOnly: false }))
    s.unscheduleProject('p1')
    expect(s.isScheduled('p1')).toBe(false)
    s.unscheduleProject('p1') // no-throw on missing
    s.stopAll()
  })

  it('fires schedule-trigger on cron ticks (second-granularity cron)', async () => {
    const s = new Scheduler()
    const triggered = new Promise<string>((resolve) => {
      s.once('schedule-trigger', ({ projectId }) => resolve(projectId))
    })

    // node-cron supports an optional seconds field: fire every second
    expect(s.scheduleProject(makeProject('p1', { enabled: true, cron: '* * * * * *', incrementalOnly: false }))).toBe(true)

    const projectId = await Promise.race([
      triggered,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('cron did not fire in 3s')), 3000))
    ])
    expect(projectId).toBe('p1')
    s.stopAll()
  })
})
