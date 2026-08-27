<template>
  <div class="sidebar-content">
    <!-- Search -->
    <div class="px-3 mb-2">
      <v-text-field
        v-model="search"
        :placeholder="t('sidebar.search')"
        density="compact"
        variant="solo-filled"
        flat
        hide-details
        prepend-inner-icon="mdi-magnify"
        clearable
      />
    </div>

    <!-- Project list -->
    <v-list v-if="filteredProjects.length > 0" density="compact" nav>
      <v-list-item
        v-for="project in filteredProjects"
        :key="project.id"
        :to="`/project/${project.id}`"
        :active="route.params.id === project.id"
        class="rounded-lg mx-2 mb-1"
        @contextmenu.prevent="showContextMenu($event, project.id)"
      >
        <template #prepend>
          <v-icon :icon="statusIcon(project.status)" :color="statusColor(project.status)" size="20" />
        </template>

        <v-list-item-title class="text-body-2 font-weight-medium truncate">
          {{ project.name || project.url || 'Untitled' }}
        </v-list-item-title>

        <v-list-item-subtitle class="text-caption truncate">
          {{ project.url || '—' }}
        </v-list-item-subtitle>

        <template #append>
          <v-chip
            v-if="downloadStore.isRunning(project.id)"
            size="x-small"
            color="primary"
            class="progress-pulse"
          >
            {{ getProgressPercent(project.id) }}%
          </v-chip>
        </template>
      </v-list-item>
    </v-list>

    <!-- Empty state -->
    <div v-else class="px-3 py-6 text-center">
      <v-icon icon="mdi-folder-outline" size="36" color="grey-lighten-1" />
      <p class="text-body-2 text-grey mt-2">{{ t('sidebar.noProjects') }}</p>
      <p class="text-caption text-grey-lighten-1">{{ t('sidebar.noProjectsHint') }}</p>
    </div>

    <!-- Right-click context menu -->
    <v-menu v-model="contextMenuOpen" :target="contextMenuTarget" open-on-click>
      <v-list density="compact">
        <v-list-item
          v-if="contextProject?.outputDir"
          prepend-icon="mdi-folder-open"
          @click="openContextProjectFolder"
        >
          {{ t('project.openFolder') }}
        </v-list-item>
        <v-list-item
          prepend-icon="mdi-content-copy"
          @click="duplicateContextProject"
        >
          {{ t('project.duplicate') }}
        </v-list-item>
        <v-divider />
        <v-list-item
          v-if="contextProject && !downloadStore.isRunning(contextProject.id) && !downloadStore.isPaused(contextProject.id)"
          prepend-icon="mdi-download"
          @click="startContextProject"
        >
          {{ t('project.start') }}
        </v-list-item>
        <v-list-item
          v-if="contextProject && downloadStore.isRunning(contextProject.id)"
          prepend-icon="mdi-pause"
          @click="pauseContextProject"
        >
          {{ t('project.pause') }}
        </v-list-item>
        <v-list-item
          v-if="contextProject && downloadStore.isPaused(contextProject.id)"
          prepend-icon="mdi-play"
          @click="resumeContextProject"
        >
          {{ t('project.resume') }}
        </v-list-item>
        <v-list-item
          v-if="contextProject && (downloadStore.isRunning(contextProject.id) || downloadStore.isPaused(contextProject.id))"
          prepend-icon="mdi-stop"
          @click="cancelContextProject"
        >
          {{ t('project.cancel') }}
        </v-list-item>
        <v-divider />
        <v-list-item
          prepend-icon="mdi-delete-outline"
          base-color="error"
          @click="confirmDelete = true"
        >
          {{ t('project.delete') }}
        </v-list-item>
      </v-list>
    </v-menu>

    <!-- Delete confirm dialog -->
    <v-dialog v-model="confirmDelete" max-width="520">
      <v-card>
        <v-card-title class="text-wrap text-error">{{ t('project.deleteConfirm') }}</v-card-title>
        <v-card-text>{{ t('project.deleteHint') }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="confirmDelete = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="error" @click="deleteContextProject">{{ t('project.delete') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="showDeletedNotice" color="success" timeout="2500">
      {{ t('project.deletedSuccess') }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useProjectStore } from '../stores/project-store'
import { useDownloadStore } from '../stores/download-store'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const downloadStore = useDownloadStore()
const search = ref('')
const contextMenuOpen = ref(false)
const contextMenuTarget = ref<[number, number]>([0, 0])
const contextMenuProjectId = ref('')
const confirmDelete = ref(false)
const showDeletedNotice = ref(false)

const contextProject = computed(() => projectStore.getProjectById(contextMenuProjectId.value))

function showContextMenu(event: MouseEvent, projectId: string): void {
  contextMenuTarget.value = [event.clientX, event.clientY]
  contextMenuProjectId.value = projectId
  contextMenuOpen.value = true
}

async function deleteContextProject(): Promise<void> {
  contextMenuOpen.value = false
  const id = contextMenuProjectId.value
  if (!id) return
  try {
    await projectStore.deleteProject(id)
    showDeletedNotice.value = true
    if (route.params.id === id) {
      router.push('/')
    }
  } catch (err) {
    console.error('Failed to delete project:', err)
  }
}

function closeContextMenu(): void {
  contextMenuOpen.value = false
}

function cloneForIpc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

async function openContextProjectFolder(): Promise<void> {
  const project = contextProject.value
  closeContextMenu()
  if (!project?.outputDir) return
  window.api.openExternal(project.outputDir)
}

async function duplicateContextProject(): Promise<void> {
  const project = contextProject.value
  closeContextMenu()
  if (!project) return

  const suffix = ' (copy)'
  const baseOutputDir = project.outputDir || ''
  const outputDir = baseOutputDir
    ? `${baseOutputDir}${baseOutputDir.endsWith(suffix) ? '' : suffix}`
    : ''

  const dup = await projectStore.createProject({
    url: project.url,
    name: project.name + suffix,
    outputDir,
    config: cloneForIpc(project.config),
    schedule: cloneForIpc(project.schedule)
  }).catch((err) => {
    console.error('Failed to duplicate project:', err)
    return null
  })

  if (dup) {
    router.push(`/project/${dup.id}`)
  }
}

async function startContextProject(): Promise<void> {
  const project = contextProject.value
  closeContextMenu()
  if (!project) return
  await downloadStore.startCrawl(project.id).catch((err) => console.error('Failed to start crawl:', err))
}

async function pauseContextProject(): Promise<void> {
  const project = contextProject.value
  closeContextMenu()
  if (!project) return
  await downloadStore.pauseCrawl(project.id).catch((err) => console.error('Failed to pause crawl:', err))
}

async function resumeContextProject(): Promise<void> {
  const project = contextProject.value
  closeContextMenu()
  if (!project) return
  await downloadStore.resumeCrawl(project.id).catch((err) => console.error('Failed to resume crawl:', err))
}

async function cancelContextProject(): Promise<void> {
  const project = contextProject.value
  closeContextMenu()
  if (!project) return
  await downloadStore.cancelCrawl(project.id).catch((err) => console.error('Failed to cancel crawl:', err))
}

onMounted(() => {
  projectStore.loadProjects()
})

const filteredProjects = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return projectStore.projects
  return projectStore.projects.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.url.toLowerCase().includes(q)
  )
})

function statusIcon(status: string): string {
  const map: Record<string, string> = {
    idle: 'mdi-circle-outline',
    crawling: 'mdi-download',
    paused: 'mdi-pause-circle',
    completed: 'mdi-check-circle',
    error: 'mdi-alert-circle',
    scheduled: 'mdi-clock-outline'
  }
  return map[status] || 'mdi-circle-outline'
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    idle: 'grey',
    crawling: 'primary',
    paused: 'warning',
    completed: 'success',
    error: 'error',
    scheduled: 'info'
  }
  return map[status] || 'grey'
}

function getProgressPercent(projectId: string): number {
  const stats = downloadStore.getStats(projectId)
  if (!stats) return 0
  const total = stats.downloaded + stats.queued
  if (total <= 0) return 0
  return Math.round((stats.downloaded / total) * 100)
}
</script>

<style scoped>
/* Allow delete-confirm title to wrap instead of being clipped */
.v-card-title.text-wrap {
  white-space: normal !important;
  overflow: visible !important;
  text-overflow: unset !important;
}
</style>
