<template>
  <v-app :theme="themeMode">
    <AppLayout />
    <v-snackbar
      :model-value="!!updater"
      color="primary"
      timeout="-1"
      location="bottom right"
    >
      <template v-if="updater?.status === 'available'">
        {{ t('settings.updateAvailable', { version: updater.version }) }}
      </template>
      <template v-else-if="updater?.status === 'progress'">
        {{ t('settings.updaterDownloading', { percent: updater.percent }) }}
      </template>
      <template v-else-if="updater?.status === 'downloaded'">
        {{ t('settings.updaterReady', { version: updater.version }) }}
      </template>
      <template #actions>
        <v-btn
          v-if="updater?.status === 'available'"
          variant="text"
          @click="downloadUpdateNow"
        >
          {{ t('settings.updaterDownload') }}
        </v-btn>
        <v-btn
          v-if="updater?.status === 'downloaded'"
          variant="text"
          @click="installUpdateNow"
        >
          {{ t('settings.updaterRestart') }}
        </v-btn>
        <v-btn variant="text" @click="updater = null">{{ t('common.cancel') }}</v-btn>
      </template>
    </v-snackbar>
    <v-snackbar
      :model-value="!!updateInfo"
      color="info"
      timeout="-1"
      location="bottom right"
    >
      {{ t('settings.updateAvailable', { version: updateInfo?.version }) }}
      <template #actions>
        <v-btn
          v-if="updateInfo?.url"
          variant="text"
          @click="openReleasePage"
        >
          {{ t('settings.openReleasePage') }}
        </v-btn>
        <v-btn variant="text" @click="updateInfo = null">{{ t('common.cancel') }}</v-btn>
      </template>
    </v-snackbar>
  </v-app>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from './stores/settings-store'
import { useDownloadStore } from './stores/download-store'
import { i18n } from './i18n'
import AppLayout from './components/AppLayout.vue'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const downloadStore = useDownloadStore()

interface UpdateInfo {
  version: string
  url: string
}
const updateInfo = ref<UpdateInfo | null>(null)

type UpdaterStatus = 'available' | 'progress' | 'downloaded'
const updater = ref<{ status: UpdaterStatus; version: string; percent: number } | null>(null)
let unsubUpdate: (() => void) | null = null

function downloadUpdateNow(): void {
  window.api.downloadUpdate().catch(() => {})
}

function installUpdateNow(): void {
  window.api.installUpdate().catch(() => {})
}

function openReleasePage(): void {
  if (updateInfo.value?.url) {
    window.api.openExternal(updateInfo.value.url).catch(() => {})
    updateInfo.value = null
  }
}

// Vuetify has no native "follow the OS" mode — track it ourselves.
const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)')
const systemPref = ref<'light' | 'dark'>(systemDarkQuery.matches ? 'dark' : 'light')

function onSystemThemeChange(e: MediaQueryListEvent): void {
  systemPref.value = e.matches ? 'dark' : 'light'
}

const themeMode = computed(() => {
  const theme = settingsStore.settings.theme
  return theme === 'system' ? systemPref.value : theme
})

let unsubEvent: (() => void) | null = null
let unsubLog: (() => void) | null = null
let unsubSchedule: (() => void) | null = null

onMounted(async () => {
  systemDarkQuery.addEventListener('change', onSystemThemeChange)
  await settingsStore.load()

  // i18n boots as 'en' regardless of the persisted setting — apply it here
  // so the chosen language survives app restarts.
  const lang = settingsStore.settings.language
  if (lang === 'en' || lang === 'tr') {
    i18n.global.locale.value = lang
  }

  // Re-attach to crawls that are still running in the main process
  downloadStore.hydrateActiveCrawls()

  // Boot-time update check (non-intrusive; manual check lives in Settings)
  if (settingsStore.settings.checkForUpdates) {
    window.api
      .checkForUpdates()
      .then((r) => {
        if (r?.available && r.latest) updateInfo.value = { version: r.latest, url: r.url || '' }
      })
      .catch(() => {})
  }

  // electron-updater flow: available → download (with progress) → restart
  unsubUpdate = window.api.onUpdateEvent((payload) => {
    if (payload.type === 'available' && payload.version) {
      updater.value = { status: 'available', version: payload.version, percent: 0 }
      updateInfo.value = null // full updater supersedes the simple notice
    } else if (payload.type === 'progress' && updater.value) {
      updater.value = { ...updater.value, status: 'progress', percent: payload.percent ?? 0 }
    } else if (payload.type === 'downloaded' && updater.value) {
      updater.value = { ...updater.value, status: 'downloaded' }
    }
  })

  // Listen for crawl events from main process
  unsubEvent = window.api.onCrawlEvent((projectId, event) => {
    downloadStore.handleCrawlEvent(projectId, event)
  })
  unsubLog = window.api.onCrawlLog((projectId, entry) => {
    downloadStore.addLog(projectId, entry)
  })
  // Scheduled (cron) crawl triggers — start the project automatically
  unsubSchedule = window.api.onScheduleTriggered((projectId) => {
    downloadStore.handleScheduledTrigger(projectId)
  })
})

onUnmounted(() => {
  systemDarkQuery.removeEventListener('change', onSystemThemeChange)
  unsubEvent?.()
  unsubLog?.()
  unsubSchedule?.()
  unsubUpdate?.()
})
</script>
