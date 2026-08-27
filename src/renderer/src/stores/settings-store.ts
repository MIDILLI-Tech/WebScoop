import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

interface AppSettings {
  language: string
  theme: 'light' | 'dark' | 'system'
  defaultOutputDir: string
  defaultConcurrency: number
  defaultRequestDelay: number
  defaultDownloadSpeedLimit: number
  defaultUserAgent: string
  defaultMaxDepth: number
  chromiumPath: string
  chromiumInstalled: boolean
  respectRobotsTxt: boolean
  maxLogEntries: number
  minimizeToTray: boolean
  checkForUpdates: boolean
  autoResumeOnLaunch: boolean
  proxyEnabled: boolean
  proxyHost: string
  proxyPort: number
  proxyUsername: string
  proxyPassword: string
}

const defaultSettings: AppSettings = {
  language: 'en',
  theme: 'system',
  defaultOutputDir: '',
  defaultConcurrency: 4,
  defaultRequestDelay: 100,
  defaultDownloadSpeedLimit: 0,
  defaultUserAgent: 'WebScoop/1.0',
  defaultMaxDepth: 5,
  chromiumPath: '',
  chromiumInstalled: false,
  respectRobotsTxt: true,
  maxLogEntries: 10000,
  minimizeToTray: false,
  checkForUpdates: true,
  autoResumeOnLaunch: false,
  proxyEnabled: false,
  proxyHost: '',
  proxyPort: 8080,
  proxyUsername: '',
  proxyPassword: ''
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>({ ...defaultSettings })
  const loaded = ref(false)
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null

  async function load(): Promise<void> {
    try {
      const stored = await window.api.getSettings()
      settings.value = { ...defaultSettings, ...stored }

      // Set default output dir if empty
      if (!settings.value.defaultOutputDir) {
        settings.value.defaultOutputDir = await window.api.getDownloadsPath()
      }

      loaded.value = true
    } catch {
      loaded.value = true
    }
  }

  async function save(): Promise<void> {
    // Plain-object clone: guarantees clean IPC serialization regardless of
    // reactive proxies or stray non-serializable fields.
    const plain = JSON.parse(JSON.stringify(settings.value))
    await window.api.updateSettings(plain)
  }

  // Auto-persist changes shortly after the user touches any setting, so
  // toggles like "minimize to tray" survive closing the window with X even
  // if the Save button was never pressed. The Save button still works and
  // gives immediate feedback.
  watch(
    settings,
    () => {
      if (!loaded.value) return
      if (autoSaveTimer) clearTimeout(autoSaveTimer)
      autoSaveTimer = setTimeout(() => {
        autoSaveTimer = null
        save().catch(() => {}) // errors surface via the explicit Save flow too
      }, 500)
    },
    { deep: true }
  )

  async function detectChromium(): Promise<string> {
    const path = await window.api.detectChromium()
    if (path) {
      settings.value.chromiumPath = path
      settings.value.chromiumInstalled = true
    } else {
      settings.value.chromiumInstalled = false
    }
    // Persist immediately so detection survives restarts even if the user
    // forgets the Save button. Errors propagate — silent failures here are
    // exactly how "saved paths disappear" bugs happen.
    await save()
    return path || ''
  }

  function setLanguage(lang: string): void {
    settings.value.language = lang
  }

  function setTheme(theme: 'light' | 'dark' | 'system'): void {
    settings.value.theme = theme
  }

  return {
    settings,
    loaded,
    load,
    save,
    detectChromium,
    setLanguage,
    setTheme
  }
})
