<template>
  <v-card flat class="pa-3">
    <!-- Live-crawl notice -->
    <v-alert
      v-if="crawlActive"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-4"
      icon="mdi-information-outline"
    >
      {{ t('form.liveNotice') }}
    </v-alert>

    <!-- URL + Name row -->
    <v-row>
      <v-col cols="12">
        <v-text-field
          v-model="form.url"
          :label="t('project.url')"
          :hint="t('project.urlHint')"
          persistent-hint
          prepend-inner-icon="mdi-link"
          placeholder="https://example.com"
          @blur="autoFillName"
        />
      </v-col>
      <v-col cols="6">
        <v-text-field
          v-model="form.name"
          :label="t('project.name')"
          prepend-inner-icon="mdi-label-outline"
        />
      </v-col>
      <v-col cols="6">
        <v-text-field
          v-model="form.baseDir"
          :label="t('project.outputDir')"
          prepend-inner-icon="mdi-folder-outline"
          readonly
          @click="selectBaseDir"
        >
          <template #append-inner>
            <v-btn size="small" variant="text" icon="mdi-folder-open" @click.stop="selectBaseDir" />
          </template>
        </v-text-field>
      </v-col>
      <v-col v-if="computedOutputDir" cols="12" class="pt-0 mt-n2">
        <div class="text-caption text-grey-darken-1">
          <v-icon icon="mdi-information-outline" size="14" class="mr-1" />
          {{ t('project.savePath') }}: <strong>{{ computedOutputDir }}</strong>
        </div>
      </v-col>
    </v-row>

    <!-- Quick Presets -->
    <div class="mb-2">
      <span class="text-caption text-grey-darken-1">{{ t('form.presets') }}</span>
      <div class="d-flex ga-2 mt-1">
        <v-chip
          v-for="preset in presets"
          :key="preset.key"
          size="small"
          variant="outlined"
          @click="applyPreset(preset.key)"
        >
          {{ preset.label }}
        </v-chip>
      </div>
    </div>

    <!-- Tabbed options -->
    <v-tabs v-model="activeTab" color="primary" density="compact" class="tabs-highlight">
      <v-tab value="general" prepend-icon="mdi-tune">
        {{ t('form.general') }}
      </v-tab>
      <v-tab value="filters" prepend-icon="mdi-filter-outline">
        {{ t('form.filters') }}
      </v-tab>
      <v-tab value="js" prepend-icon="mdi-language-javascript">
        {{ t('form.jsRendering') }}
      </v-tab>
      <v-tab value="auth" prepend-icon="mdi-lock-outline">
        {{ t('form.auth') }}
      </v-tab>
      <v-tab value="schedule" prepend-icon="mdi-calendar-clock">
        {{ t('form.schedule') }}
      </v-tab>
    </v-tabs>

    <v-window v-model="activeTab" class="mt-4">
      <!-- General Tab -->
      <v-window-item value="general" class="pt-3">
        <v-row>
          <v-col cols="6">
            <v-text-field v-model.number="form.config.maxDepth" :label="t('form.maxDepth')" :hint="t('form.maxDepthHint')" persistent-hint type="number" min="0" />
          </v-col>
          <v-col cols="6">
            <v-text-field v-model.number="form.config.maxPages" :label="t('form.maxPages')" :hint="t('form.maxPagesHint')" persistent-hint type="number" min="0" />
          </v-col>
          <v-col cols="12">
            <div class="d-flex align-center">
              <span class="text-body-2 mr-4" style="min-width: 160px">
                {{ t('form.concurrency') }}
              </span>
              <v-slider
                v-model="form.config.concurrency"
                :min="1"
                :max="20"
                :step="1"
                thumb-label="always"
                color="primary"
                hide-details
                class="flex-grow-1"
              />
              <span class="text-body-2 ml-2 mono" style="min-width: 30px">
                {{ form.config.concurrency }}
              </span>
            </div>
          </v-col>
          <v-col cols="6">
            <v-text-field v-model.number="form.config.requestDelay" :label="t('form.requestDelay')" type="number" min="0" suffix="ms" />
          </v-col>
          <v-col cols="6">
            <v-text-field v-model.number="form.config.downloadSpeedLimit" :label="t('form.downloadSpeedLimit')" type="number" min="0" suffix="KB/s" />
          </v-col>
          <v-col cols="6">
            <v-text-field v-model.number="form.config.timeout" :label="t('form.timeout')" type="number" min="1" suffix="s" />
          </v-col>
          <v-col cols="6">
            <v-text-field v-model.number="form.config.maxFileSize" :label="t('form.maxFileSize')" type="number" min="0" suffix="MB" />
          </v-col>
          <v-col cols="6">
            <v-select
              v-model="form.config.domainRestriction"
              :label="t('form.domainRestriction')"
              :items="domainOptions"
            />
          </v-col>
          <v-col cols="8">
            <v-text-field v-model="form.config.userAgent" :label="t('form.userAgent')" />
          </v-col>
          <v-col cols="2">
            <v-text-field v-model.number="form.config.retries" :label="t('form.retries')" type="number" min="0" max="10" />
          </v-col>
          <v-col cols="2">
            <v-text-field v-model.number="form.config.retryDelay" :label="t('form.retryDelay')" type="number" min="0" suffix="ms" />
          </v-col>
          <v-col cols="12" class="pl-12">
            <v-switch
              v-model="form.config.respectRobotsTxt"
              :label="t('form.respectRobots')"
              :hint="t('form.respectRobotsHint')"
              persistent-hint
              color="primary"
            />
            <v-alert
              v-if="!form.config.respectRobotsTxt"
              type="warning"
              density="compact"
              variant="tonal"
              class="mt-2"
            >
              {{ t('form.ignoreRobotsWarning') }}
            </v-alert>
          </v-col>
        </v-row>
      </v-window-item>

      <!-- Filters Tab -->
      <v-window-item value="filters" class="pt-3">
        <v-row>
          <v-col cols="6">
            <v-textarea v-model="includePatterns" :label="t('form.includePatterns')" rows="3" auto-grow placeholder=".*\.html$&#10;.*\.css$" />
          </v-col>
          <v-col cols="6">
            <v-textarea v-model="excludePatterns" :label="t('form.excludePatterns')" rows="3" auto-grow placeholder=".*\.zip$&#10;.*\.exe$" />
          </v-col>
          <v-col cols="6">
            <v-combobox
              v-model="form.config.filters.includeExtensions"
              :label="t('form.includeExtensions')"
              multiple
              chips
              closable-chips
              placeholder=".html, .css, .js, .png"
            />
          </v-col>
          <v-col cols="6">
            <v-combobox
              v-model="form.config.filters.excludeExtensions"
              :label="t('form.excludeExtensions')"
              multiple
              chips
              closable-chips
              placeholder=".zip, .exe, .msi"
            />
          </v-col>
        </v-row>
      </v-window-item>

      <!-- JS Rendering Tab -->
      <v-window-item value="js" class="pt-3">
        <v-row class="mx-0">
          <v-col cols="12" class="pl-12">
            <v-switch
              v-model="form.config.enableJsRendering"
              :label="t('form.enableJs')"
              :hint="t('form.enableJsHint')"
              persistent-hint
              color="primary"
            />
          </v-col>
          <v-col v-if="form.config.enableJsRendering" cols="12">
            <v-text-field
              v-model.number="form.config.jsRenderWaitTime"
              :label="t('form.jsWaitTime')"
              type="number"
              min="0"
              suffix="ms"
            />
            <v-alert
              v-if="!chromiumDetected"
              type="warning"
              density="compact"
              variant="tonal"
              class="mt-2"
            >
              <div class="d-flex align-center">
                <span>{{ t('form.chromiumNotFound') }}</span>
                <v-btn size="small" variant="text" class="ml-2" @click="detectChromium">
                  {{ t('settings.chromiumDetect') }}
                </v-btn>
              </div>
            </v-alert>
            <v-alert v-else type="success" density="compact" variant="tonal" class="mt-2">
              {{ t('form.chromiumDetected', { path: chromiumPath }) }}
            </v-alert>
          </v-col>
        </v-row>
      </v-window-item>

      <!-- Auth Tab -->
      <v-window-item value="auth" class="pt-3">
        <v-row>
          <v-col cols="12">
            <v-select
              v-model="authType"
              :label="t('form.authType')"
              :items="authOptions"
            />
          </v-col>
          <template v-if="authType === 'basic'">
            <v-col cols="6">
              <v-text-field v-model="form.config.auth.username" :label="t('form.username')" />
            </v-col>
            <v-col cols="6">
              <v-text-field v-model="form.config.auth.password" :label="t('form.password')" type="password" />
            </v-col>
          </template>
          <template v-if="authType === 'cookie'">
            <v-col cols="12">
              <v-textarea
                v-model="form.config.auth.cookies"
                :label="t('form.cookies')"
                :hint="t('form.cookiesHint')"
                persistent-hint
                rows="3"
              />
            </v-col>
          </template>
          <template v-if="authType === 'form-login'">
            <v-col cols="8">
              <v-text-field v-model="form.config.auth.loginUrl" :label="t('form.loginUrl')" placeholder="https://example.com/login" />
            </v-col>
            <v-col cols="4" class="d-flex align-center">
              <v-btn color="secondary" prepend-icon="mdi-open-in-new" @click="openLoginWindow">
                {{ t('form.openLoginWindow') }}
              </v-btn>
            </v-col>
            <v-col cols="12">
              <v-alert type="info" density="compact" variant="tonal">
                {{ t('form.loginWindowHint') }}
              </v-alert>
            </v-col>
            <v-col v-if="form.config.auth.cookies" cols="12">
              <v-alert type="success" density="compact" variant="tonal">
                {{ t('form.cookiesCaptured', { count: form.config.auth.cookies.split(';').filter(Boolean).length }) }}
              </v-alert>
            </v-col>
          </template>
        </v-row>
      </v-window-item>

      <!-- Schedule Tab -->
      <v-window-item value="schedule" class="pt-3">
        <ScheduleManager :project-id="projectId" v-model="form.schedule" />
      </v-window-item>
    </v-window>

    <!-- Action buttons (sticky so they stay reachable on long tabs) -->
    <div class="action-bar d-flex ga-2">
      <v-btn
        v-if="!crawlActive"
        color="primary"
        size="large"
        prepend-icon="mdi-download"
        :loading="saving"
        :disabled="!urlValid"
        @click="saveAndStart"
      >
        {{ t('project.start') }}
      </v-btn>
      <v-btn
        variant="outlined"
        size="large"
        :loading="saving"
        :disabled="!urlValid || !isDirty"
        @click="saveProject"
      >
        {{ t('common.save') }}
      </v-btn>
      <v-spacer />
      <span v-if="isDirty" class="text-caption text-warning align-self-center">
        {{ t('form.unsavedHint') }}
      </span>
    </div>

    <v-snackbar v-model="showSaved" color="success" timeout="2000">
      {{ t('settings.saved') }}
    </v-snackbar>
    <v-snackbar v-model="showError" color="error" timeout="4000">
      {{ saveError }}
    </v-snackbar>
  </v-card>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '../stores/settings-store'
import { useProjectStore } from '../stores/project-store'
import { useDownloadStore } from '../stores/download-store'
import ScheduleManager from './ScheduleManager.vue'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const projectStore = useProjectStore()
const downloadStore = useDownloadStore()

const props = defineProps<{
  projectId: string
}>()

const emit = defineEmits<{
  saved: []
  started: []
  unsavedChanged: [value: boolean]
}>()

const activeTab = ref('general')
const saving = ref(false)
const showSaved = ref(false)
const saveError = ref('')
const showError = computed({
  get: () => !!saveError.value,
  set: (val: boolean) => { if (!val) saveError.value = '' }
})
const crawlActive = computed(
  () => downloadStore.isRunning(props.projectId) || downloadStore.isPaused(props.projectId)
)

const urlValid = computed(() => {
  try {
    const u = new URL(form.url.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
})
const chromiumDetected = ref(false)
const chromiumPath = ref('')
const formInitialized = ref(false)
const savedSnapshot = ref('')
const isDirty = ref(false)
let liveSyncTimer: ReturnType<typeof setTimeout> | null = null

const form = reactive({
  name: '',
  url: 'https://',
  baseDir: '',
  config: {
    maxDepth: 5,
    maxPages: 0,
    maxFileSize: 100,
    concurrency: 4,
    requestDelay: 100,
    downloadSpeedLimit: 0,
    timeout: 30,
    userAgent: 'WebScoop/1.0',
    respectRobotsTxt: true,
    enableJsRendering: false,
    jsRenderWaitTime: 3000,
    domainRestriction: 'same-host' as const,
    filters: {
      includePatterns: [] as string[],
      excludePatterns: [] as string[],
      includeExtensions: [] as string[],
      excludeExtensions: [] as string[],
      includeMimeTypes: [] as string[],
      excludeMimeTypes: [] as string[]
    },
    auth: {
      type: 'none' as string,
      username: '',
      password: '',
      cookies: '',
      loginUrl: '',
      headers: {} as Record<string, string>
    },
    retries: 3,
    retryDelay: 1000
  },
  schedule: {
    enabled: false,
    cron: '',
    incrementalOnly: false
  }
})

const includePatterns = computed({
  get: () => form.config.filters.includePatterns.join('\n'),
  set: (val: string) => { form.config.filters.includePatterns = val.split('\n').filter(Boolean) }
})

const excludePatterns = computed({
  get: () => form.config.filters.excludePatterns.join('\n'),
  set: (val: string) => { form.config.filters.excludePatterns = val.split('\n').filter(Boolean) }
})

const authType = computed({
  get: () => form.config.auth.type,
  set: (val: string) => { form.config.auth.type = val }
})

const domainOptions = computed(() => [
  { title: t('form.sameHost'), value: 'same-host' },
  { title: t('form.sameDomain'), value: 'same-domain' },
  { title: t('form.anyDomain'), value: 'any' }
])

const authOptions = computed(() => [
  { title: t('form.authNone'), value: 'none' },
  { title: t('form.authBasic'), value: 'basic' },
  { title: t('form.authCookie'), value: 'cookie' },
  { title: t('form.authFormLogin'), value: 'form-login' }
])

const presets = computed(() => [
  { key: 'full', label: t('form.presetFullSite') },
  { key: 'images', label: t('form.presetImagesOnly') },
  { key: 'single', label: t('form.presetSinglePage') },
  { key: 'docs', label: t('form.presetDocuments') }
])

onMounted(async () => {
  const project = await projectStore.loadProject(props.projectId)
  if (project) {
    form.name = project.name
    form.url = project.url
    // Extract baseDir from existing outputDir (parent of project subfolder)
    if (project.outputDir) {
      const lastSep = Math.max(project.outputDir.lastIndexOf('/'), project.outputDir.lastIndexOf('\\'))
      form.baseDir = lastSep > 0 ? project.outputDir.substring(0, lastSep) : project.outputDir
    }
    if (project.config) {
      Object.assign(form.config, project.config)
      // Convert maxFileSize from bytes to MB for display
      form.config.maxFileSize = Math.round((project.config.maxFileSize || 104857600) / (1024 * 1024))
      form.config.timeout = Math.round((project.config.timeout || 30000) / 1000)
      if (project.config.auth) Object.assign(form.config.auth, project.config.auth)
      if (project.config.filters) Object.assign(form.config.filters, project.config.filters)
    }
    if (project.schedule) Object.assign(form.schedule, project.schedule)
  }

  // Set default baseDir from settings if not set
  if (!form.baseDir) {
    form.baseDir = settingsStore.settings.defaultOutputDir || await window.api.getDownloadsPath()
  }

  // Use saved Chromium path first; only auto-detect if missing.
  chromiumPath.value = settingsStore.settings.chromiumPath || ''
  chromiumDetected.value = !!chromiumPath.value
  if (!chromiumDetected.value) {
    try {
      const path = await settingsStore.detectChromium()
      chromiumDetected.value = !!path
      chromiumPath.value = path
    } catch {
      // Keep form usable even if chromium detect fails.
    }
  }
  markSavedSnapshot()
  formInitialized.value = true
})

/** Sanitize name for use as folder name */
function sanitizeFolderName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').toLowerCase() || 'project'
}

/** Computed full output directory: baseDir / sanitized project name */
const computedOutputDir = computed(() => {
  if (!form.baseDir || !form.name) return ''
  const sep = form.baseDir.includes('\\') ? '\\' : '/'
  return form.baseDir + sep + sanitizeFolderName(form.name)
})

function autoFillName(): void {
  const normalizedName = (form.name || '').trim()
  const canAutoFill = !normalizedName || normalizedName === 'New Project' || normalizedName === 'Untitled Project'
  if (!canAutoFill || !form.url) return
  try {
    const url = new URL(form.url)
    form.name = url.hostname
  } catch { /* skip */ }
}

async function selectBaseDir(): Promise<void> {
  try {
    const dir = await window.api.selectDirectory()
    if (dir) form.baseDir = dir
  } catch (err) {
    console.error('Failed to select directory:', err)
  }
}

function applyPreset(key: string): void {
  switch (key) {
    case 'full':
      form.config.maxDepth = 10
      form.config.maxPages = 0
      form.config.filters.includeExtensions = []
      form.config.filters.excludeExtensions = []
      break
    case 'images':
      form.config.maxDepth = 3
      form.config.filters.includeExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']
      break
    case 'single':
      // Only the start page (plus its assets): cap page count AND depth.
      form.config.maxDepth = 1
      form.config.maxPages = 1
      break
    case 'docs':
      form.config.filters.includeExtensions = ['.html', '.htm', '.pdf', '.doc', '.docx', '.txt']
      break
  }
}

async function detectChromium(): Promise<void> {
  try {
    const path = await settingsStore.detectChromium()
    chromiumDetected.value = !!path
    chromiumPath.value = path
  } catch (err) {
    console.error('Chromium detection failed:', err)
  }
}

async function openLoginWindow(): Promise<void> {
  const loginUrl = form.config.auth.loginUrl || form.url
  if (!loginUrl) return
  try {
    const cookies = await window.api.captureAuthCookies(loginUrl)
    if (cookies) {
      // Keep auth.type as-is: cookies are applied independently of the auth
      // type by the crawler, and switching to 'cookie' would yank the user
      // out of the form-login section before they see the success alert.
      form.config.auth.cookies = cookies
    }
  } catch (err) {
    console.error('Login window failed:', err)
  }
}

function buildConfig(): any {
  return {
    ...form.config,
    maxFileSize: form.config.maxFileSize * 1024 * 1024,
    timeout: form.config.timeout * 1000
  }
}

function serializeForIpc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function buildSnapshot(): string {
  const snapshot = {
    name: (form.name || '').trim(),
    url: (form.url || '').trim(),
    baseDir: (form.baseDir || '').trim(),
    config: serializeForIpc(buildConfig()),
    schedule: serializeForIpc(form.schedule)
  }
  return JSON.stringify(snapshot)
}

function markSavedSnapshot(): void {
  savedSnapshot.value = buildSnapshot()
  isDirty.value = false
  emit('unsavedChanged', false)
}

function emitUnsavedState(): void {
  if (!formInitialized.value) return
  const dirty = buildSnapshot() !== savedSnapshot.value
  isDirty.value = dirty
  emit('unsavedChanged', dirty)
}

function buildProjectPayload(): {
  name: string
  url: string
  outputDir: string
  config: any
  schedule: any
} {
  const name = form.name.trim()
  const url = form.url.trim()
  const baseDir = form.baseDir.trim()

  if (!url) {
    throw new Error('Project URL is empty')
  }

  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only http and https URLs are supported')
    }
  } catch (err: any) {
    throw new Error(`Invalid URL: ${err?.message || String(err)}`, { cause: err })
  }

  if (!baseDir) {
    throw new Error('Please choose a base output directory')
  }

  const finalName = name || 'project'
  const outputDir = computedOutputDir.value || `${baseDir}${baseDir.includes('\\') ? '\\' : '/'}${sanitizeFolderName(finalName)}`

  return {
    name: finalName,
    url,
    outputDir,
    config: serializeForIpc(buildConfig()),
    schedule: serializeForIpc(form.schedule)
  }
}

async function saveProject(): Promise<void> {
  saving.value = true
  try {
    saveError.value = ''
    await projectStore.updateProject(props.projectId, buildProjectPayload())
    markSavedSnapshot()
    showSaved.value = true
    emit('saved')
  } catch (err: any) {
    saveError.value = err?.message || String(err)
  } finally {
    saving.value = false
  }
}

async function saveAndStart(): Promise<void> {
  saving.value = true
  try {
    saveError.value = ''
    await projectStore.updateProject(props.projectId, buildProjectPayload())
    markSavedSnapshot()
    await downloadStore.startCrawl(props.projectId)
    emit('started')
  } catch (err: any) {
    saveError.value = err?.message || String(err)
  } finally {
    saving.value = false
  }
}

watch(form, () => {
  emitUnsavedState()
}, { deep: true })

watch(() => form.url, () => {
  const currentName = form.name.trim()
  if (!currentName || currentName === 'New Project' || currentName === 'Untitled Project') {
    autoFillName()
  }
})

watch([
  () => form.config.concurrency,
  () => form.config.requestDelay,
  () => form.config.downloadSpeedLimit
], () => {
  if (!formInitialized.value) return
  if (!downloadStore.isRunning(props.projectId) && !downloadStore.isPaused(props.projectId)) return

  if (liveSyncTimer) {
    clearTimeout(liveSyncTimer)
  }

  liveSyncTimer = setTimeout(async () => {
    try {
      await downloadStore.setConcurrency(props.projectId, form.config.concurrency)
      await downloadStore.setRequestDelay(props.projectId, form.config.requestDelay)
      await downloadStore.setDownloadSpeedLimit(props.projectId, form.config.downloadSpeedLimit)
    } catch (err: any) {
      saveError.value = err?.message || String(err)
    }
  }, 250)
})
</script>

<style scoped>
.action-bar {
  position: sticky;
  bottom: 0;
  z-index: 2;
  margin-top: 12px;
  padding: 10px 0 2px;
  background: rgb(var(--v-theme-surface));
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.tabs-highlight :deep(.v-tab) {
  transition: all 0.2s ease;
}
.tabs-highlight :deep(.v-tab--active) {
  background: rgba(33, 150, 243, 0.14);
  border-radius: 6px;
  font-weight: 600;
}

/* Pull the slider value bubble down so its wedge tip meets the thumb */
:deep(.v-slider-thumb__label) {
  bottom: calc(var(--v-slider-thumb-size) / 2 - 4px) !important;
}
</style>
