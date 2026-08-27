import type {
  CrawlProject,
  CrawlStats,
  CrawlEvent,
  LogEntry,
  AppSettings,
  ScheduleConfig
} from '../../core/types'

export interface WebScoopApi {
  /* Projects */
  getProjects(): Promise<CrawlProject[]>
  getProject(id: string): Promise<CrawlProject | null>
  createProject(data: Partial<CrawlProject>): Promise<CrawlProject>
  updateProject(id: string, updates: Partial<CrawlProject>): Promise<CrawlProject>
  deleteProject(id: string): Promise<void>

  /* Crawl */
  startCrawl(projectId: string): Promise<{ success: boolean; outputDir?: string; project?: CrawlProject }>
  pauseCrawl(projectId: string): Promise<{ success: boolean }>
  resumeCrawl(projectId: string): Promise<{ success: boolean }>
  cancelCrawl(projectId: string): Promise<{ success: boolean }>
  setConcurrency(projectId: string, n: number): Promise<{ success: boolean }>
  setRequestDelay(projectId: string, delayMs: number): Promise<{ success: boolean }>
  setDownloadSpeedLimit(projectId: string, kbps: number): Promise<{ success: boolean }>
  getCrawlStats(projectId: string): Promise<CrawlStats | null>
  isCrawlRunning(projectId: string): Promise<boolean>
  getActiveCrawls(): Promise<
    Array<{ projectId: string; stats: CrawlStats; paused: boolean; outputDir?: string }>
  >
  getProjectLogs(
    projectId: string
  ): Promise<Array<{ level: string; message: string; url?: string; timestamp: number }>>
  clearProjectLogs(projectId: string): Promise<{ success: boolean }>
  checkForUpdates(): Promise<{
    available: boolean
    current?: string
    latest?: string
    url?: string
    error?: string
  }>
  downloadUpdate(): Promise<{ success: boolean; error?: string }>
  installUpdate(): Promise<{ success: boolean }>
  retryFailedUrls(projectId: string): Promise<{ success: boolean; count: number }>
  onUpdateEvent(
    callback: (payload: { type: string; version?: string; percent?: number }) => void
  ): () => void

  /* Schedule */
  setSchedule(projectId: string, config: ScheduleConfig): Promise<boolean>
  removeSchedule(projectId: string): Promise<void>
  getScheduledProjects(): Promise<string[]>
  isScheduled(projectId: string): Promise<boolean>

  /* Settings */
  getSettings(): Promise<AppSettings>
  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>

  /* Auth */
  captureAuthCookies(loginUrl: string): Promise<string>

  /* Chromium */
  detectChromium(): Promise<string>

  /* Dialog & Shell */
  selectDirectory(): Promise<string | null>
  selectFile(filters?: Array<{ name: string; extensions: string[] }>): Promise<string | null>
  openInBrowser(filePath: string): Promise<void>
  openInExplorer(dirPath: string): Promise<void>
  openExternal(pathOrUrl: string): Promise<void>
  getProjectFiles(projectId: string): Promise<{ tree: any[]; totalFiles: number; totalSize: number } | null>
  getUserDataPath(): Promise<string>
  getDownloadsPath(): Promise<string>

  /* Events */
  onCrawlEvent(callback: (projectId: string, event: CrawlEvent) => void): () => void
  onCrawlLog(callback: (projectId: string, entry: LogEntry) => void): () => void
  onScheduleTriggered(callback: (projectId: string) => void): () => void
}

declare global {
  interface Window {
    api: WebScoopApi
  }
}
