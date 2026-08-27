<template>
  <v-container class="py-4" style="max-width: 800px">
    <h1 class="text-subtitle-1 font-weight-bold mb-4">{{ t('settings.title') }}</h1>

    <!-- Appearance -->
    <v-card variant="outlined" class="mb-4">
      <v-card-title>{{ t('settings.appearance') }}</v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="6">
            <v-select
              v-model="settingsStore.settings.language"
              :label="t('settings.language')"
              :items="languages"
              prepend-inner-icon="mdi-translate"
              @update:model-value="changeLanguage"
            />
          </v-col>
          <v-col cols="6">
            <v-select
              v-model="settingsStore.settings.theme"
              :label="t('settings.theme')"
              :items="themes"
              prepend-inner-icon="mdi-palette"
              @update:model-value="changeTheme"
            />
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Download defaults -->
    <v-card variant="outlined" class="mb-4">
      <v-card-title>{{ t('settings.downloadDefaults') }}</v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="12">
            <v-text-field
              v-model="settingsStore.settings.defaultOutputDir"
              :label="t('settings.defaultOutputDir')"
              prepend-inner-icon="mdi-folder-outline"
              readonly
              @click="selectDefaultDir"
            >
              <template #append-inner>
                <v-btn size="small" variant="text" icon="mdi-folder-open" @click="selectDefaultDir" />
              </template>
            </v-text-field>
          </v-col>
          <v-col cols="12">
            <div class="d-flex align-center">
              <span class="text-body-2 mr-4" style="min-width: 160px">
                {{ t('settings.defaultConcurrency') }}
              </span>
              <v-slider
                v-model="settingsStore.settings.defaultConcurrency"
                :min="1"
                :max="20"
                :step="1"
                thumb-label="always"
                color="primary"
                hide-details
                class="flex-grow-1"
              />
              <span class="text-body-2 ml-2 mono" style="min-width: 30px">
                {{ settingsStore.settings.defaultConcurrency }}
              </span>
            </div>
          </v-col>
          <v-col cols="6">
            <v-text-field
              v-model.number="settingsStore.settings.defaultRequestDelay"
              :label="t('settings.defaultRequestDelay')"
              :hint="t('settings.defaultRequestDelayHint')"
              persistent-hint
              type="number"
              min="0"
              suffix="ms"
            />
          </v-col>
          <v-col cols="6">
            <v-text-field
              v-model.number="settingsStore.settings.defaultDownloadSpeedLimit"
              :label="t('settings.defaultDownloadSpeedLimit')"
              :hint="t('settings.defaultDownloadSpeedLimitHint')"
              persistent-hint
              type="number"
              min="0"
              suffix="KB/s"
            />
          </v-col>
          <v-col cols="12">
            <v-text-field
              v-model="settingsStore.settings.defaultUserAgent"
              :label="t('settings.defaultUserAgent')"
            />
          </v-col>
          <v-col cols="12" class="pt-0 mt-n2">
            <v-switch
              v-model="settingsStore.settings.respectRobotsTxt"
              :label="t('settings.respectRobots')"
              :hint="t('settings.respectRobotsHint')"
              persistent-hint
              color="primary"
            />
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Chromium / JS Rendering -->
    <v-card variant="outlined" class="mb-4">
      <v-card-title>{{ t('settings.chromium') }}</v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="12">
            <v-text-field
              v-model="settingsStore.settings.chromiumPath"
              :label="t('settings.chromiumPath')"
              prepend-inner-icon="mdi-google-chrome"
              clearable
              :hint="t('settings.chromiumPathHint')"
              persistent-hint
            >
              <template #append-inner>
                <v-btn size="small" variant="text" icon="mdi-file-find-outline" @click="browseChromium" />
                <v-btn size="small" variant="text" @click="detectChromium" :loading="detecting">
                  {{ t('settings.chromiumDetect') }}
                </v-btn>
              </template>
            </v-text-field>
          </v-col>
          <v-col cols="12">
            <v-alert
              v-if="settingsStore.settings.chromiumPath"
              type="success"
              density="compact"
              variant="tonal"
            >
              {{ t('settings.chromiumFound', { path: settingsStore.settings.chromiumPath }) }}
            </v-alert>
            <v-alert
              v-else
              type="warning"
              density="compact"
              variant="tonal"
            >
              {{ t('settings.chromiumNotFound') }}
            </v-alert>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- System -->
    <v-card variant="outlined" class="mb-4">
      <v-card-title>{{ t('settings.system') }}</v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="12">
            <v-switch
              v-model="settingsStore.settings.minimizeToTray"
              :label="t('settings.minimizeToTray')"
              :hint="t('settings.minimizeToTrayHint')"
              persistent-hint
              color="primary"
            />
          </v-col>
          <v-col cols="12">
            <v-switch
              v-model="settingsStore.settings.checkForUpdates"
              :label="t('settings.checkUpdates')"
              color="primary"
              hide-details
            />
            <div class="d-flex align-center mt-1">
              <v-btn
                size="small"
                variant="text"
                prepend-icon="mdi-refresh"
                :loading="updateChecking"
                @click="checkUpdates"
              >
                {{ t('settings.checkNow') }}
              </v-btn>
              <span v-if="updateMessage" class="text-caption text-grey ml-2">
                {{ updateMessage }}
              </span>
            </div>
          </v-col>
          <v-col cols="12">
            <v-switch
              v-model="settingsStore.settings.autoResumeOnLaunch"
              :label="t('settings.autoResume')"
              :hint="t('settings.autoResumeHint')"
              persistent-hint
              color="primary"
            />
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Proxy -->
    <v-card variant="outlined" class="mb-4">
      <v-card-title>{{ t('settings.proxy') }}</v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="12">
            <v-switch
              v-model="settingsStore.settings.proxyEnabled"
              :label="t('settings.proxyEnable')"
              color="primary"
              hide-details
            />
          </v-col>
          <template v-if="settingsStore.settings.proxyEnabled">
            <v-col cols="8">
              <v-text-field v-model="settingsStore.settings.proxyHost" :label="t('settings.proxyHost')" placeholder="proxy.example.com" />
            </v-col>
            <v-col cols="4">
              <v-text-field v-model.number="settingsStore.settings.proxyPort" :label="t('settings.proxyPort')" type="number" placeholder="8080" />
            </v-col>
            <v-col cols="6">
              <v-text-field v-model="settingsStore.settings.proxyUsername" :label="t('settings.proxyUsername')" />
            </v-col>
            <v-col cols="6">
              <v-text-field v-model="settingsStore.settings.proxyPassword" :label="t('settings.proxyPassword')" type="password" />
            </v-col>
          </template>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Save -->
    <div class="d-flex justify-end">
      <v-btn color="primary" size="large" @click="saveSettings" :loading="saving">
        {{ t('common.save') }}
      </v-btn>
    </div>

    <v-snackbar v-model="saved" color="success" timeout="2000">
      {{ t('settings.saved') }}
    </v-snackbar>

    <v-snackbar v-model="showError" color="error" timeout="4000">
      {{ errorMsg }}
    </v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from 'vuetify'
import { useSettingsStore } from '../stores/settings-store'

const { t, locale } = useI18n()
const vuetifyTheme = useTheme()
const settingsStore = useSettingsStore()

const saving = ref(false)
const saved = ref(false)
const detecting = ref(false)
const errorMsg = ref('')
const showError = ref(false)

function setError(err: unknown): void {
  errorMsg.value = err instanceof Error ? err.message : String(err)
  showError.value = true
}

const languages = [
  { title: 'English', value: 'en' },
  { title: 'Türkçe', value: 'tr' }
]

const themes = [
  { title: t('settings.themeLight'), value: 'light' },
  { title: t('settings.themeDark'), value: 'dark' },
  { title: t('settings.themeSystem'), value: 'system' }
]

function changeLanguage(lang: string): void {
  locale.value = lang
}

const updateChecking = ref(false)
const updateMessage = ref('')

async function checkUpdates(): Promise<void> {
  updateChecking.value = true
  updateMessage.value = ''
  try {
    const r = await window.api.checkForUpdates()
    if (r.available) {
      updateMessage.value = t('settings.updateAvailable', { version: r.latest })
    } else if (r.error) {
      updateMessage.value = t('settings.updateCheckFailed')
    } else {
      updateMessage.value = t('settings.upToDate', { version: r.current })
    }
  } catch {
    updateMessage.value = t('settings.updateCheckFailed')
  } finally {
    updateChecking.value = false
  }
}

function changeTheme(theme: string): void {
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    vuetifyTheme.global.name.value = prefersDark ? 'dark' : 'light'
  } else {
    vuetifyTheme.global.name.value = theme
  }
}

async function selectDefaultDir(): Promise<void> {
  const dir = await window.api.selectDirectory()
  if (dir) settingsStore.settings.defaultOutputDir = dir
}

async function browseChromium(): Promise<void> {
  const file = await window.api.selectFile([
    { name: 'Chromium / Chrome', extensions: ['exe', 'app', 'bin'] },
    { name: 'All Files', extensions: ['*'] }
  ])
  if (file) {
    settingsStore.settings.chromiumPath = file
    settingsStore.settings.chromiumInstalled = true
  }
}

async function detectChromium(): Promise<void> {
  detecting.value = true
  try {
    const path = await settingsStore.detectChromium()
    if (path) {
      settingsStore.settings.chromiumPath = path
      settingsStore.settings.chromiumInstalled = true
    } else {
      settingsStore.settings.chromiumPath = ''
      settingsStore.settings.chromiumInstalled = false
    }
  } catch (err) {
    setError(err)
  } finally {
    detecting.value = false
  }
}

async function saveSettings(): Promise<void> {
  saving.value = true
  try {
    await settingsStore.save()
    saved.value = true
  } catch (err) {
    setError(err)
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await settingsStore.load()
})
</script>

<style scoped>
/* Pull the slider value bubble down so its wedge tip meets the thumb */
:deep(.v-slider-thumb__label) {
  bottom: calc(var(--v-slider-thumb-size) / 2 - 4px) !important;
}
</style>
