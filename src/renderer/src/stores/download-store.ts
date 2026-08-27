import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

interface CrawlStats {
  totalUrls: number
  downloadedUrls: number
  failedUrls: number
  skippedUrls: number
  totalBytes: number
  filesDownloaded: number
  startTime?: string
  endTime?: string
  duration?: number
  currentUrl?: string
  downloadSpeed?: number
  byType: Record<string, number | { count: number; bytes: number }>
}

interface LogEntry {
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  url?: string
  timestamp: number
}

interface ActiveFile {
  url: string
  filename: string
  percent: number
}

/** Normalized stats shape for UI components */
interface UiStats {
  downloaded: number
  queued: number
  failed: number
  totalBytes: number
  speed: number
  outputDir: string
  byType: Record<string, { count: number; bytes: number }>
}

const emptyUiStats: UiStats = {
  downloaded: 0, queued: 0, failed: 0, totalBytes: 0, speed: 0, outputDir: '', byType: {}
}

function normalizeByType(
  byType: Record<string, number | { count: number; bytes: number }> | undefined
): Record<string, { count: number; bytes: number }> {
  const result: Record<string, { count: number; bytes: number }> = {}
  if (!byType) return result

  for (const [key, value] of Object.entries(byType)) {
    if (typeof value === 'number') {
      result[key] = { count: Number.isFinite(value) ? value : 0, bytes: 0 }
      continue
    }

    const count = Number(value?.count)
    const bytes = Number(value?.bytes)
    result[key] = {
      count: Number.isFinite(count) ? count : 0,
      bytes: Number.isFinite(bytes) ? bytes : 0
    }
  }

  return result
}

export const useDownloadStore = defineStore('download', () => {
  const statsMap = ref<Record<string, CrawlStats>>({})
  const logsMap = ref<Record<string, LogEntry[]>>({})
  const runningProjects = ref<Set<string>>(new Set())
  const pausedProjects = ref<Set<string>>(new Set())
  const stoppedProjects = ref<Set<string>>(new Set())
  const activeFilesMap = ref<Record<string, ActiveFile[]>>({})
  const outputDirMap = ref<Record<string, string>>({})
  const elapsedMap = ref<Record<string, number>>({})
  const justCompleted = ref<Set<string>>(new Set())
  const _elapsedTimers = new Map<string, ReturnType<typeof setInterval>>()
  const maxLogEntries = 10_000

  function _startElapsedTimer(projectId: string): void {
    if (_elapsedTimers.has(projectId)) return
    const timer = setInterval(() => {
      elapsedMap.value[projectId] = (elapsedMap.value[projectId] ?? 0) + 1
    }, 1000)
    _elapsedTimers.set(projectId, timer)
  }

  function _stopElapsedTimer(projectId: string): void {
    const timer = _elapsedTimers.get(projectId)
    if (timer) {
      clearInterval(timer)
      _elapsedTimers.delete(projectId)
    }
  }

  function getElapsed(projectId: string): number {
    return elapsedMap.value[projectId] ?? 0
  }

  function getStats(projectId: string): UiStats {
    const s = statsMap.value[projectId]
    if (!s) return { ...emptyUiStats }
    const isActive = runningProjects.value.has(projectId) || pausedProjects.value.has(projectId)
    return {
      downloaded: s.filesDownloaded,
      queued: isActive ? Math.max(0, s.totalUrls - s.downloadedUrls - s.failedUrls - s.skippedUrls) : 0,
      failed: s.failedUrls,
      totalBytes: s.totalBytes,
      speed: isActive ? (s.downloadSpeed || 0) : 0,
      outputDir: outputDirMap.value[projectId] || '',
      byType: normalizeByType(s.byType)
    }
  }

  function hydrateProjectState(projectId: string, payload: { stats?: CrawlStats; outputDir?: string }): void {
    if (payload.stats) {
      statsMap.value[projectId] = payload.stats
    }
    if (payload.outputDir) {
      outputDirMap.value[projectId] = payload.outputDir
    }
  }

  /**
   * Re-attach the UI to crawls that are still running in the main process
   * (e.g. after a renderer reload). Paused crawls restore their paused state
   * so the correct Resume button shows instead of Start.
   */
  async function hydrateActiveCrawls(): Promise<void> {
    try {
      const active = await window.api.getActiveCrawls()
      if (!Array.isArray(active)) return
      for (const item of active) {
        const { projectId } = item
        if (!projectId || runningProjects.value.has(projectId) || pausedProjects.value.has(projectId)) {
          continue
        }
        if (item.stats) statsMap.value[projectId] = item.stats
        if (item.outputDir) outputDirMap.value[projectId] = item.outputDir
        if (item.paused) {
          pausedProjects.value.add(projectId)
        } else {
          runningProjects.value.add(projectId)
          _startElapsedTimer(projectId)
        }
        stoppedProjects.value.delete(projectId)
      }
    } catch { /* non-fatal: live events will re-attach anyway */ }
  }

  /** Seed the in-memory log buffer from SQLite on first open of the Log tab. */
  async function loadPersistedLogs(projectId: string): Promise<void> {
    if (logsMap.value[projectId]?.length) return
    try {
      const rows = await window.api.getProjectLogs(projectId)
      if (Array.isArray(rows) && rows.length > 0 && !logsMap.value[projectId]?.length) {
        logsMap.value[projectId] = rows as LogEntry[]
      }
    } catch { /* non-fatal */ }
  }

  const getRunningCount = computed(() => runningProjects.value.size)

  function getLogs(projectId: string): LogEntry[] {
    return logsMap.value[projectId] ?? []
  }

  function getActiveFiles(projectId: string): ActiveFile[] {
    return activeFilesMap.value[projectId] ?? []
  }

  function handleCrawlEvent(projectId: string, event: { type: string; data: any }): void {
    switch (event.type) {
      case 'stats-update':
        statsMap.value[projectId] = event.data as CrawlStats
        // Do not override a user pause with in-flight stats updates.
        if (!pausedProjects.value.has(projectId)) {
          runningProjects.value.add(projectId)
        }
        stoppedProjects.value.delete(projectId)
        break
      case 'active-downloads':
        activeFilesMap.value[projectId] = event.data as ActiveFile[]
        break
      case 'crawl-complete':
      case 'crawl-error':
        statsMap.value[projectId] = event.data as CrawlStats
        _stopElapsedTimer(projectId)
        runningProjects.value.delete(projectId)
        pausedProjects.value.delete(projectId)
        if (event.type === 'crawl-complete') {
          justCompleted.value.add(projectId)
        }
        break
      case 'crawl-paused':
        _stopElapsedTimer(projectId)
        runningProjects.value.delete(projectId)
        pausedProjects.value.add(projectId)
        break
      case 'crawl-resumed':
        _startElapsedTimer(projectId)
        runningProjects.value.add(projectId)
        pausedProjects.value.delete(projectId)
        stoppedProjects.value.delete(projectId)
        break
    }
  }

  function addLog(projectId: string, entry: LogEntry): void {
    if (!logsMap.value[projectId]) {
      logsMap.value[projectId] = []
    }
    const logs = logsMap.value[projectId]
    logs.push(entry)
    if (logs.length > maxLogEntries) {
      logs.splice(0, logs.length - maxLogEntries)
    }
  }

  function clearLogs(projectId: string): void {
    logsMap.value[projectId] = []
  }

  function isRunning(projectId: string): boolean {
    return runningProjects.value.has(projectId)
  }

  function isPaused(projectId: string): boolean {
    return pausedProjects.value.has(projectId)
  }

  function isStopped(projectId: string): boolean {
    return stoppedProjects.value.has(projectId)
  }

  /** True (once) if the last finished run ended with 'crawl-complete'. */
  function consumeCompleted(projectId: string): boolean {
    if (!justCompleted.value.has(projectId)) return false
    justCompleted.value.delete(projectId)
    return true
  }

  async function startCrawl(projectId: string): Promise<void> {
    // Clear previous run state so a manual restart begins from 0% in UI.
    statsMap.value[projectId] = {
      totalUrls: 0,
      downloadedUrls: 0,
      failedUrls: 0,
      skippedUrls: 0,
      totalBytes: 0,
      filesDownloaded: 0,
      byType: {}
    }
    activeFilesMap.value[projectId] = []

    const result = await window.api.startCrawl(projectId)
    if (result?.success) {
      elapsedMap.value[projectId] = 0
      _stopElapsedTimer(projectId)
      _startElapsedTimer(projectId)
      runningProjects.value.add(projectId)
      pausedProjects.value.delete(projectId)
      stoppedProjects.value.delete(projectId)

      // Main may have auto-generated the output dir — keep UI in sync so
      // "Open Folder" never receives an empty path.
      if (result.outputDir) {
        outputDirMap.value[projectId] = result.outputDir
      }
      if (result.project) {
        try {
          const { useProjectStore } = await import('./project-store')
          const projectStore = useProjectStore()
          const row = projectStore.projects.find((p) => p.id === projectId)
          if (row) {
            row.outputDir = result.project.outputDir ?? row.outputDir
            row.status = result.project.status ?? row.status
          }
        } catch { /* non-fatal */ }
      }
    }
  }

  async function pauseCrawl(projectId: string): Promise<void> {
    await window.api.pauseCrawl(projectId)
  }

  async function resumeCrawl(projectId: string): Promise<void> {
    await window.api.resumeCrawl(projectId)
  }

  async function cancelCrawl(projectId: string): Promise<void> {
    await window.api.cancelCrawl(projectId)
    _stopElapsedTimer(projectId)
    runningProjects.value.delete(projectId)
    pausedProjects.value.delete(projectId)
    stoppedProjects.value.add(projectId)
  }

  /** Re-queue only failed URLs; caller starts the crawl to process them. */
  async function retryFailed(projectId: string): Promise<number> {
    const result = await window.api.retryFailedUrls(projectId)
    return result?.count ?? 0
  }

  /** Called when a cron-scheduled trigger fires for a project. */
  async function handleScheduledTrigger(projectId: string): Promise<void> {
    try {
      if (isRunning(projectId) || isPaused(projectId)) return // already active
      await startCrawl(projectId)
    } catch { /* scheduled run failed; main process logs details */ }
  }

  async function setConcurrency(projectId: string, n: number): Promise<void> {
    await window.api.setConcurrency(projectId, n)
  }

  async function setRequestDelay(projectId: string, delayMs: number): Promise<void> {
    await window.api.setRequestDelay(projectId, delayMs)
  }

  async function setDownloadSpeedLimit(projectId: string, kbps: number): Promise<void> {
    const setLimit = (window.api as any).setDownloadSpeedLimit
    if (typeof setLimit !== 'function') {
      throw new Error('Download speed throttle is unavailable in this app session. Please restart WebScoop.')
    }
    await setLimit(projectId, kbps)
  }

  function setOutputDir(projectId: string, dir: string): void {
    outputDirMap.value[projectId] = dir
  }

  return {
    statsMap,
    logsMap,
    runningProjects,
    pausedProjects,
    stoppedProjects,
    activeFilesMap,
    elapsedMap,
    getStats,
    hydrateProjectState,
    hydrateActiveCrawls,
    loadPersistedLogs,
    getElapsed,
    getRunningCount,
    getLogs,
    getActiveFiles,
    handleCrawlEvent,
    addLog,
    clearLogs,
    isRunning,
    isPaused,
    isStopped,
    consumeCompleted,
    startCrawl,
    pauseCrawl,
    resumeCrawl,
    cancelCrawl,
    retryFailed,
    handleScheduledTrigger,
    setConcurrency,
    setRequestDelay,
    setDownloadSpeedLimit,
    setOutputDir
  }
})
