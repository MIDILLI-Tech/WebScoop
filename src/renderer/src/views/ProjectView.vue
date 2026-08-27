<template>
  <v-container v-if="project" class="py-2 px-4" fluid>
    <!-- Header -->
    <div class="d-flex align-center mb-3">
      <v-btn icon="mdi-arrow-left" variant="text" size="small" @click="$router.push('/')" />
      <div class="ml-1">
        <h2 class="text-subtitle-1 font-weight-bold">{{ project.name }}</h2>
        <span class="text-caption text-grey">{{ project.url }}</span>
      </div>
      <v-spacer />
      <v-chip :color="statusColor" variant="elevated" class="mr-2">
        <v-icon start :icon="statusIcon" /> {{ statusLabel }}
      </v-chip>
      <v-btn
        v-if="!downloadStore.isRunning(projectId) && !downloadStore.isPaused(projectId)"
        color="primary"
        prepend-icon="mdi-download"
        @click="startCrawl"
      >
        {{ t('project.start') }}
      </v-btn>
      <v-btn
        v-if="downloadStore.isRunning(projectId)"
        color="warning"
        prepend-icon="mdi-pause"
        variant="outlined"
        @click="pauseCrawl"
      >
        {{ t('project.pause') }}
      </v-btn>
      <v-btn
        v-if="downloadStore.isPaused(projectId)"
        color="success"
        prepend-icon="mdi-play"
        @click="resumeCrawl"
      >
        {{ t('project.resume') }}
      </v-btn>
      <v-menu>
        <template #activator="{ props: menuProps }">
          <v-btn icon="mdi-dots-vertical" variant="text" v-bind="menuProps" class="ml-1" />
        </template>
        <v-list density="compact">
          <v-list-item prepend-icon="mdi-folder-open" @click="openOutputDir">
            {{ t('project.openFolder') }}
          </v-list-item>
          <v-list-item prepend-icon="mdi-content-copy" @click="duplicateProject">
            {{ t('project.duplicate') }}
          </v-list-item>
          <v-divider />
          <v-list-item prepend-icon="mdi-delete" base-color="error" @click="confirmDelete = true">
            {{ t('project.delete') }}
          </v-list-item>
        </v-list>
      </v-menu>
    </div>

    <!-- Tabs -->
    <v-tabs v-model="activeTab" color="primary" density="compact" class="mb-3">
      <v-tab value="config" prepend-icon="mdi-cog">
        {{ t('project.config') }}
        <span v-if="hasUnsavedConfig" class="ml-1 text-warning">*</span>
      </v-tab>
      <v-tab value="progress" prepend-icon="mdi-chart-line">
        {{ t('project.statusTab') }}
        <v-badge
          v-if="downloadStore.isRunning(projectId)"
          :content="overallPercent + '%'"
          color="primary"
          inline
          class="ml-1"
        />
      </v-tab>
      <v-tab value="files" prepend-icon="mdi-file-tree">
        {{ t('project.files') }}
        <v-badge
          v-if="stats.downloaded > 0"
          :content="stats.downloaded"
          color="info"
          inline
          class="ml-1"
        />
      </v-tab>
      <v-tab value="log" prepend-icon="mdi-text-box">
        {{ t('project.log') }}
        <v-badge
          v-if="errorCount > 0"
          :content="errorCount"
          color="error"
          inline
          class="ml-1"
        />
      </v-tab>
    </v-tabs>

    <v-window v-model="activeTab">
      <v-window-item value="config">
        <DownloadForm
          :key="projectId"
          :project-id="projectId"
          @started="onFormStarted"
          @saved="onFormSaved"
          @unsaved-changed="onFormUnsavedChanged"
        />
      </v-window-item>
      <v-window-item value="progress">
        <ProgressView :project-id="projectId" />
      </v-window-item>
      <v-window-item value="files">
        <FileTree :project-id="projectId" :output-dir="project.outputDir || ''" />
      </v-window-item>
      <v-window-item value="log">
        <LogViewer :project-id="projectId" />
      </v-window-item>
    </v-window>

    <!-- Delete confirm dialog -->
    <v-dialog v-model="confirmDelete" max-width="520">
      <v-card>
        <v-card-title class="text-wrap text-error">{{ t('project.deleteConfirm') }}</v-card-title>
        <v-card-text>{{ t('project.deleteHint') }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="confirmDelete = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="error" @click="deleteProject">{{ t('project.delete') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Unsaved changes: leave confirm dialog -->
    <v-dialog v-model="confirmLeave" max-width="400" persistent>
      <v-card>
        <v-card-title>{{ t('project.leaveTitle') }}</v-card-title>
        <v-card-text>{{ t('project.leaveText') }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="confirmLeave = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="warning" @click="leaveAnyway">{{ t('project.leaveDiscard') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="showActionError" color="error" timeout="4000">
      {{ actionError }}
    </v-snackbar>

    <!-- Crawl completed -->
    <v-snackbar v-model="showCompleted" color="success" timeout="6000">
      {{ t('project.doneMsg') }}
      <template #actions>
        <v-btn variant="text" @click="openFolderFromSnackbar">
          {{ t('project.openFolder') }}
        </v-btn>
      </template>
    </v-snackbar>
  </v-container>

  <!-- Loading / not found -->
  <v-container v-else class="py-8 text-center">
    <v-progress-circular indeterminate color="primary" size="48" />
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import type { RouteLocationNormalized } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useProjectStore } from '../stores/project-store'
import { useDownloadStore } from '../stores/download-store'
import DownloadForm from '../components/DownloadForm.vue'
import ProgressView from '../components/ProgressView.vue'
import FileTree from '../components/FileTree.vue'
import LogViewer from '../components/LogViewer.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const downloadStore = useDownloadStore()

const activeTab = ref('config')
const confirmDelete = ref(false)
const hasUnsavedConfig = ref(false)
const actionError = ref('')
const showCompleted = ref(false)
const confirmLeave = ref(false)
let pendingLeave: RouteLocationNormalized | null = null
const showActionError = computed({
  get: () => !!actionError.value,
  set: (val: boolean) => {
    if (!val) actionError.value = ''
  }
})

const projectId = computed(() => route.params.id as string)
const project = computed(() => projectStore.projects.find(p => p.id === projectId.value))
const stats = computed(() => downloadStore.getStats(projectId.value))
const errorCount = computed(() => downloadStore.getLogs(projectId.value).filter(l => l.level === 'error').length)

const overallPercent = computed(() => {
  const total = stats.value.downloaded + stats.value.queued
  if (total === 0) return 0
  return Math.round((stats.value.downloaded / total) * 100)
})

const statusColor = computed(() => {
  if (downloadStore.isRunning(projectId.value)) return 'success'
  if (downloadStore.isPaused(projectId.value)) return 'warning'
  if (downloadStore.isStopped(projectId.value)) return 'orange'
  if (project.value?.status === 'paused') return 'warning'
  if (project.value?.status === 'completed') return 'primary'
  if (project.value?.status === 'error') return 'error'
  if (project.value?.status === 'crawling') return 'success'
  return 'grey'
})

const statusIcon = computed(() => {
  if (downloadStore.isRunning(projectId.value)) return 'mdi-download'
  if (downloadStore.isPaused(projectId.value)) return 'mdi-pause-circle'
  if (downloadStore.isStopped(projectId.value)) return 'mdi-stop-circle-outline'
  if (project.value?.status === 'paused') return 'mdi-pause-circle'
  if (project.value?.status === 'completed') return 'mdi-check-circle'
  if (project.value?.status === 'error') return 'mdi-alert-circle'
  return 'mdi-clock-outline'
})

const statusLabel = computed(() => {
  if (downloadStore.isRunning(projectId.value)) return t('progress.downloading')
  if (downloadStore.isPaused(projectId.value)) return t('progress.paused')
  if (downloadStore.isStopped(projectId.value)) return t('progress.stopped')
  if (project.value?.status === 'paused') return t('progress.paused')
  if (project.value?.status === 'completed') return t('progress.done')
  if (project.value?.status === 'error') return t('progress.failed')
  return t('progress.idle')
})

function ensureDefaultTabForProjectStatus(): void {
  if (project.value?.status === 'completed') {
    activeTab.value = 'progress'
  }
}

async function startCrawl(): Promise<void> {
  try {
    actionError.value = ''

    if (hasUnsavedConfig.value) {
      actionError.value = t('project.unsavedChangesWarning')
      activeTab.value = 'config'
      return
    }

    await downloadStore.startCrawl(projectId.value)
    activeTab.value = 'progress'
  } catch (err: any) {
    actionError.value = err?.message || String(err)
  }
}

async function pauseCrawl(): Promise<void> {
  try {
    actionError.value = ''
    await downloadStore.pauseCrawl(projectId.value)
  } catch (err: any) {
    actionError.value = err?.message || String(err)
  }
}

async function resumeCrawl(): Promise<void> {
  try {
    actionError.value = ''
    await downloadStore.resumeCrawl(projectId.value)
  } catch (err: any) {
    actionError.value = err?.message || String(err)
  }
}

function onFormUnsavedChanged(value: boolean): void {
  hasUnsavedConfig.value = value
}

async function onFormSaved(): Promise<void> {
  await projectStore.loadProject(projectId.value)
}

async function onFormStarted(): Promise<void> {
  await projectStore.loadProject(projectId.value)
  activeTab.value = 'progress'
}

function openOutputDir(): void {
  if (project.value?.outputDir) {
    window.api.openExternal(project.value.outputDir)
  }
}

function openFolderFromSnackbar(): void {
  showCompleted.value = false
  openOutputDir()
}

function leaveAnyway(): void {
  confirmLeave.value = false
  const target = pendingLeave
  pendingLeave = null
  hasUnsavedConfig.value = false
  if (target) router.push(target)
}

onBeforeRouteLeave((to) => {
  if (!hasUnsavedConfig.value) return true
  pendingLeave = to
  confirmLeave.value = true
  return false
})

async function duplicateProject(): Promise<void> {
  if (!project.value) return

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const suffix = ' (copy)'
  const baseOutputDir = project.value.outputDir || ''
  const outputDir = baseOutputDir
    ? `${baseOutputDir}${baseOutputDir.endsWith(suffix) ? '' : suffix}`
    : ''

  try {
    const dup = await projectStore.createProject({
      url: project.value.url,
      name: project.value.name + suffix,
      outputDir,
      config: clone(project.value.config),
      schedule: clone(project.value.schedule)
    })
    if (dup) router.push(`/project/${dup.id}`)
  } catch (err: any) {
    actionError.value = err?.message || String(err)
  }
}

async function deleteProject(): Promise<void> {
  try {
    await projectStore.deleteProject(projectId.value)
    confirmDelete.value = false
    router.push('/')
  } catch (err: any) {
    actionError.value = err?.message || String(err)
    confirmDelete.value = false
  }
}

onMounted(() => {
  if (projectId.value) {
    projectStore.loadProject(projectId.value).then(() => {
      ensureDefaultTabForProjectStatus()
    })
  }
})

watch(projectId, (id) => {
  if (id) {
    projectStore.loadProject(id).then(() => {
      ensureDefaultTabForProjectStatus()
    })
    activeTab.value = 'config'
    hasUnsavedConfig.value = false
  }
})

watch(() => project.value?.status, () => {
  ensureDefaultTabForProjectStatus()
})

// Auto-switch to progress when crawl starts; on end refresh the project row
// and toast a completion snackbar (natural completion only).
watch(() => downloadStore.isRunning(projectId.value), (running, prev) => {
  if (running) {
    activeTab.value = 'progress'
  } else if (prev) {
    projectStore.loadProject(projectId.value).catch(() => {})
    if (downloadStore.consumeCompleted(projectId.value)) {
      showCompleted.value = true
    }
  }
})
</script>

<style scoped>
/* Allow delete-confirm title to wrap instead of being clipped */
.v-card-title.text-wrap {
  white-space: normal !important;
  overflow: visible !important;
  text-overflow: unset !important;
}
</style>
