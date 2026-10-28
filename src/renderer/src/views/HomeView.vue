<template>
  <v-container class="py-4">
    <!-- Welcome header -->
    <div class="d-flex align-center mb-4">
      <img :src="logoUrl" alt="WebScoop" class="home-logo mr-3" />
      <p class="text-body-2 text-grey mb-0">{{ t('home.subtitle') }}</p>
    </div>

    <!-- Quick start -->
    <v-card class="mb-4 pa-3" variant="outlined">
      <div class="text-subtitle-2 mb-2">{{ t('home.quickStart') }}</div>
      <v-row align="center" density="compact">
        <v-col cols="9">
          <v-text-field
            v-model="quickUrl"
            :label="t('home.enterUrl')"
            placeholder="https://example.com"
            prepend-inner-icon="mdi-link"
            hide-details
            @keyup.enter="quickCreate"
          />
        </v-col>
        <v-col cols="3">
          <v-btn
            color="primary"
            block
            prepend-icon="mdi-download"
            :disabled="!canQuickCreate"
            @click="quickCreate"
          >
            {{ t('home.grab') }}
          </v-btn>
        </v-col>
      </v-row>
      <div class="text-caption text-grey mt-2">
        {{ t('home.grabHint') }}
      </div>
    </v-card>

    <!-- Stats overview -->
    <v-row density="compact" class="mb-4">
      <v-col cols="3">
        <v-card variant="tonal" color="primary" class="pa-2 text-center">
          <v-icon icon="mdi-folder-multiple" size="20" class="mb-1" />
          <div class="text-h6 font-weight-bold">{{ projectStore.projects.length }}</div>
          <div class="text-caption">{{ t('home.totalProjects') }}</div>
        </v-card>
      </v-col>
      <v-col cols="3">
        <v-card variant="tonal" color="success" class="pa-2 text-center">
          <v-icon icon="mdi-check-circle" size="20" class="mb-1" />
          <div class="text-h6 font-weight-bold">{{ completedCount }}</div>
          <div class="text-caption">{{ t('home.completed') }}</div>
        </v-card>
      </v-col>
      <v-col cols="3">
        <v-card variant="tonal" color="info" class="pa-2 text-center">
          <v-icon icon="mdi-download" size="20" class="mb-1" />
          <div class="text-h6 font-weight-bold">{{ activeCount }}</div>
          <div class="text-caption">{{ t('home.active') }}</div>
        </v-card>
      </v-col>
      <v-col cols="3">
        <v-card variant="tonal" color="secondary" class="pa-2 text-center">
          <v-icon icon="mdi-harddisk" size="20" class="mb-1" />
          <div class="text-h6 font-weight-bold">{{ formatBytes(totalSize) }}</div>
          <div class="text-caption">{{ t('home.totalDownloaded') }}</div>
        </v-card>
      </v-col>
    </v-row>

    <!-- Recent projects -->
    <v-card v-if="recentProjects.length > 0" variant="outlined" class="mb-4">
      <v-card-title class="text-subtitle-1">{{ t('home.recentProjects') }}</v-card-title>
      <v-list>
        <v-list-item
          v-for="project in recentProjects"
          :key="project.id"
          :to="`/project/${project.id}`"
          :title="project.name"
          :subtitle="project.url"
        >
          <template #prepend>
            <v-icon :icon="statusIcon(project.status)" :color="statusColor(project.status)" />
          </template>
          <template #append>
            <span class="text-caption text-grey">{{ formatDate(project.updatedAt) }}</span>
          </template>
        </v-list-item>
      </v-list>
    </v-card>

    <!-- Empty state -->
    <v-card v-else variant="tonal" class="pa-6 text-center">
      <v-icon icon="mdi-rocket-launch-outline" size="40" color="grey" class="mb-2" />
      <div class="text-subtitle-1 mb-1">{{ t('home.noProjects') }}</div>
      <div class="text-body-2 text-grey mb-4">{{ t('home.noProjectsHint') }}</div>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useProjectStore } from '../stores/project-store'
import { useDownloadStore } from '../stores/download-store'
import logoUrl from '../assets/webscoop.png'

const { t } = useI18n()
const router = useRouter()
const projectStore = useProjectStore()
const downloadStore = useDownloadStore()

const quickUrl = ref('https://')

const canQuickCreate = computed(() => {
  const raw = quickUrl.value.trim()
  if (!raw) return false
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const parsed = new URL(candidate)
    return ['http:', 'https:'].includes(parsed.protocol) && !!parsed.hostname
  } catch {
    return false
  }
})

const recentProjects = computed(() =>
  [...projectStore.projects]
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, 5)
)

const completedCount = computed(() => projectStore.projects.filter(p => p.status === 'completed').length)
const activeCount = computed(() => projectStore.projects.filter(p => p.status === 'crawling').length)
const totalSize = computed(() => projectStore.projects.reduce((sum, p) => sum + (p.stats?.totalBytes || 0), 0))

async function quickCreate(): Promise<void> {
  if (!canQuickCreate.value) return
  const raw = quickUrl.value.trim()
  const normalizedUrl = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  let hostname: string
  try {
    hostname = new URL(normalizedUrl).hostname
  } catch {
    return
  }

  // Quick grab = single page + its assets (predictable scope). Full-site
  // mirroring belongs in the project config; partial config is merged over
  // defaults by the project:create handler.
  const project = await projectStore.createProject({
    url: normalizedUrl,
    name: hostname,
    config: { maxDepth: 1, maxPages: 1 }
  })
  if (project) {
    router.push(`/project/${project.id}`)
    // Auto-start the download after creating the project
    try {
      await downloadStore.startCrawl(project.id)
    } catch { /* ignore – user can start manually from project view */ }
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

function formatDate(ts?: string): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString()
}

function statusIcon(status?: string): string {
  const icons: Record<string, string> = {
    crawling: 'mdi-download', paused: 'mdi-pause-circle', completed: 'mdi-check-circle',
    error: 'mdi-alert-circle', scheduled: 'mdi-clock-outline', idle: 'mdi-circle-outline'
  }
  return icons[status || 'idle'] || 'mdi-circle-outline'
}

function statusColor(status?: string): string {
  const colors: Record<string, string> = {
    crawling: 'info', paused: 'warning', completed: 'success',
    error: 'error', scheduled: 'secondary', idle: 'grey'
  }
  return colors[status || 'idle'] || 'grey'
}

onMounted(() => {
  projectStore.loadProjects()
})
</script>

<style scoped>
.home-logo {
  height: 44px;
  display: block;
}
</style>
