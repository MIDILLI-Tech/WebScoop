import { contextBridge, ipcRenderer } from 'electron'

const api = {
  /* Projects */
  getProjects: () => ipcRenderer.invoke('project:get-all'),
  getProject: (id: string) => ipcRenderer.invoke('project:get', id),
  createProject: (data: any) => ipcRenderer.invoke('project:create', data),
  updateProject: (id: string, updates: any) => ipcRenderer.invoke('project:update', id, updates),
  deleteProject: (id: string) => ipcRenderer.invoke('project:delete', id),

  /* Crawl */
  startCrawl: (projectId: string) => ipcRenderer.invoke('crawl:start', projectId),
  pauseCrawl: (projectId: string) => ipcRenderer.invoke('crawl:pause', projectId),
  resumeCrawl: (projectId: string) => ipcRenderer.invoke('crawl:resume', projectId),
  cancelCrawl: (projectId: string) => ipcRenderer.invoke('crawl:cancel', projectId),
  setConcurrency: (projectId: string, n: number) =>
    ipcRenderer.invoke('crawl:set-concurrency', projectId, n),
  setRequestDelay: (projectId: string, delayMs: number) =>
    ipcRenderer.invoke('crawl:set-request-delay', projectId, delayMs),
  setDownloadSpeedLimit: (projectId: string, kbps: number) =>
    ipcRenderer.invoke('crawl:set-download-speed-limit', projectId, kbps),
  getCrawlStats: (projectId: string) => ipcRenderer.invoke('crawl:get-stats', projectId),
  isCrawlRunning: (projectId: string) => ipcRenderer.invoke('crawl:is-running', projectId),
  getActiveCrawls: () => ipcRenderer.invoke('crawl:get-active'),
  getProjectLogs: (projectId: string) => ipcRenderer.invoke('log:get', projectId),
  clearProjectLogs: (projectId: string) => ipcRenderer.invoke('log:clear', projectId),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  retryFailedUrls: (projectId: string) => ipcRenderer.invoke('crawl:retry-failed', projectId),

  /* Schedule */
  setSchedule: (projectId: string, config: any) =>
    ipcRenderer.invoke('schedule:set', projectId, config),
  removeSchedule: (projectId: string) => ipcRenderer.invoke('schedule:remove', projectId),
  getScheduledProjects: () => ipcRenderer.invoke('schedule:get-all'),
  isScheduled: (projectId: string) => ipcRenderer.invoke('schedule:is-scheduled', projectId),

  /* Settings */
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings: any) => ipcRenderer.invoke('settings:update', settings),

  /* Auth */
  captureAuthCookies: (loginUrl: string) => ipcRenderer.invoke('auth:capture-cookies', loginUrl),

  /* Chromium */
  detectChromium: () => ipcRenderer.invoke('chromium:detect'),

  /* Dialog & Shell */
  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),
  selectFile: (filters?: Array<{ name: string; extensions: string[] }>) =>
    ipcRenderer.invoke('dialog:select-file', filters),
  openInBrowser: (filePath: string) => ipcRenderer.invoke('shell:open-in-browser', filePath),
  openInExplorer: (dirPath: string) => ipcRenderer.invoke('shell:open-in-explorer', dirPath),
  openExternal: (pathOrUrl: string) => ipcRenderer.invoke('shell:open-external', pathOrUrl),
  getProjectFiles: (projectId: string) => ipcRenderer.invoke('project:get-files', projectId),
  getUserDataPath: () => ipcRenderer.invoke('app:get-user-data-path'),
  getDownloadsPath: () => ipcRenderer.invoke('app:get-downloads-path'),

  /* Events from main process */
  onCrawlEvent: (callback: (projectId: string, event: any) => void) => {
    const handler = (_e: any, projectId: string, event: any) => callback(projectId, event)
    ipcRenderer.on('crawl:event', handler)
    return () => ipcRenderer.removeListener('crawl:event', handler)
  },
  onCrawlLog: (callback: (projectId: string, entry: any) => void) => {
    const handler = (_e: any, projectId: string, entry: any) => callback(projectId, entry)
    ipcRenderer.on('crawl:log', handler)
    return () => ipcRenderer.removeListener('crawl:log', handler)
  },
  onScheduleTriggered: (callback: (projectId: string) => void) => {
    const handler = (_e: any, projectId: string) => callback(projectId)
    ipcRenderer.on('schedule:triggered', handler)
    return () => ipcRenderer.removeListener('schedule:triggered', handler)
  },
  onUpdateEvent: (callback: (payload: { type: string; version?: string; percent?: number }) => void) => {
    const handler = (_e: any, payload: { type: string; version?: string; percent?: number }) =>
      callback(payload)
    ipcRenderer.on('update:event', handler)
    return () => ipcRenderer.removeListener('update:event', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
