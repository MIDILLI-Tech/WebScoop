<template>
  <v-card flat class="pa-3">
    <!-- Top stats row -->
    <v-row density="compact" class="mb-3">
      <v-col cols="3">
        <v-card variant="tonal" color="primary" class="pa-2 text-center">
          <div class="text-h6 mono">{{ stats.downloaded }}</div>
          <div class="text-caption">{{ t('progress.downloaded') }}</div>
        </v-card>
      </v-col>
      <v-col cols="3">
        <v-card variant="tonal" color="info" class="pa-2 text-center">
          <div class="text-h6 mono">{{ stats.queued }}</div>
          <div class="text-caption">{{ t('progress.queued') }}</div>
        </v-card>
      </v-col>
      <v-col cols="3">
        <v-card variant="tonal" :color="stats.failed > 0 ? 'error' : 'grey'" class="pa-2 text-center">
          <div class="text-h6 mono">{{ stats.failed }}</div>
          <div class="text-caption">{{ t('progress.failed') }}</div>
        </v-card>
      </v-col>
      <v-col cols="3">
        <v-card variant="tonal" color="secondary" class="pa-2 text-center">
          <div class="text-h6 mono">{{ formatBytes(stats.totalBytes) }}</div>
          <div class="text-caption">{{ t('progress.totalSize') }}</div>
        </v-card>
      </v-col>
    </v-row>

    <!-- Main progress row -->
    <v-row>
      <!-- Overall progress area -->
      <v-col cols="8">
        <!-- Overall file progress -->
        <div class="mb-4">
          <div class="d-flex justify-space-between mb-1">
            <span class="text-body-2 font-weight-bold">{{ t('progress.overall') }}</span>
            <span class="text-body-2 mono">
              {{ stats.downloaded }} / {{ stats.downloaded + stats.queued }}
              <span class="text-grey">·</span>
              {{ overallPercent }}%
            </span>
          </div>
          <!-- Count lives in the header above so the fill boundary never
               slices through the text. While the queue is still growing
               (discovery dominates) an honest fill would stay tiny, so show
               a full-width sweeping bar instead; once the queue drains the
               real percentage takes over and expands to 100%. -->
          <v-progress-linear
            v-if="discovering"
            indeterminate
            striped
            color="primary"
            height="10"
            rounded
          />
          <v-progress-linear
            v-else
            :model-value="overallPercent"
            color="primary"
            height="10"
            rounded
            :striped="downloadStore.isRunning(projectId)"
          />
        </div>

        <!-- Per-type breakdown -->
        <div class="mb-3">
          <span class="text-body-2 font-weight-bold mb-2 d-block">
            {{ t('progress.byType') }}
          </span>
          <div v-for="item in typeBreakdown" :key="item.type" class="d-flex align-center mb-2">
            <v-icon :icon="item.icon" size="18" class="mr-2" :color="item.color" />
            <span class="text-caption mr-2" style="min-width: 60px">{{ item.label }}</span>
            <v-progress-linear
              :model-value="item.percent"
              :color="item.color"
              height="10"
              rounded
              class="flex-grow-1"
            />
            <span class="text-caption mono ml-2" style="min-width: 44px; text-align: right">
              {{ item.count }}
            </span>
            <span class="text-caption mono ml-2 text-grey" style="min-width: 72px; text-align: right">
              {{ formatBytes(item.bytes) }}
            </span>
          </div>
        </div>

        <!-- Active parallel downloads -->
        <div v-if="downloadStore.isRunning(projectId) || downloadStore.isPaused(projectId) || activeDownloads.length > 0" class="mb-3">
          <div class="d-flex align-center mb-1">
            <span class="text-body-2 font-weight-bold">
              {{ t('progress.activeDownloads', { count: downloadSlots.filter(s => s.url).length }) }}
            </span>
            <v-spacer />
            <!-- Live slot control: applies immediately while a crawl is active -->
            <div
              v-if="downloadStore.isRunning(projectId) || downloadStore.isPaused(projectId)"
              class="d-flex align-center"
            >
              <span class="text-caption text-grey mr-1">{{ t('form.concurrency') }}</span>
              <v-btn
                icon="mdi-minus"
                size="x-small"
                variant="text"
                :disabled="liveConcurrency <= 1"
                @click="bumpConcurrency(-1)"
              />
              <span class="text-body-2 mono mx-1" style="min-width: 22px; text-align: center">
                {{ liveConcurrency }}
              </span>
              <v-btn
                icon="mdi-plus"
                size="x-small"
                variant="text"
                :disabled="liveConcurrency >= 20"
                @click="bumpConcurrency(1)"
              />
            </div>
          </div>
          <div class="text-caption text-grey mb-1">
            {{ t('progress.parallelSlots', { active: downloadSlots.filter(s => s.url).length, total: downloadSlots.length }) }}
          </div>
          <div
            v-for="(slot, idx) in downloadSlots"
            :key="slot.url || `waiting-${idx}`"
            class="d-flex align-center mb-1"
            :class="slot.url ? 'active-download-row' : 'waiting-download-row'"
            @click="slot.url ? openDownloadUrl(slot.url) : undefined"
            :title="slot.url || t('progress.waiting')"
          >
            <v-progress-circular
              :model-value="slot.percent"
              size="20"
              width="2"
              color="primary"
              class="mr-2"
            />
            <span class="text-caption text-truncate flex-grow-1">
              {{ slot.filename || t('progress.waiting') }}
            </span>
            <span class="text-caption mono ml-2">{{ slot.percent }}%</span>
          </div>
        </div>
      </v-col>

      <!-- Right side: circular + info -->
      <v-col cols="4" class="d-flex flex-column align-center">
        <!-- Big circular progress -->
        <v-progress-circular
          :model-value="overallPercent"
          :size="160"
          :width="12"
          color="primary"
          class="mb-4"
        >
          <div class="text-center">
            <div class="text-h4 font-weight-bold">{{ overallPercent }}%</div>
            <div class="text-caption text-grey">{{ t('progress.complete') }}</div>
          </div>
        </v-progress-circular>

        <!-- Elapsed time -->
        <v-card variant="outlined" class="pa-3 mb-3 text-center" style="width: 100%">
          <v-icon icon="mdi-timer-outline" class="mr-1" size="18" />
          <span class="text-body-2">{{ t('progress.elapsed') }}</span>
          <div class="text-h6 mono mt-1">{{ elapsedFormatted }}</div>
        </v-card>

        <!-- Speed gauge -->
        <v-card variant="outlined" class="pa-3 mb-3 text-center" style="width: 100%">
          <v-icon icon="mdi-speedometer" class="mr-1" size="18" />
          <span class="text-body-2">{{ t('progress.speed') }}</span>
          <div class="text-h6 mono mt-1">{{ formatSpeed(stats.speed) }}</div>
        </v-card>

        <!-- Status -->
        <v-chip
          :color="statusColor"
          variant="elevated"
          size="large"
          class="mb-3"
        >
          <v-icon start :icon="statusIcon" />
          {{ statusLabel }}
        </v-chip>

        <!-- Controls -->
        <div class="d-flex ga-2">
          <v-btn
            v-if="downloadStore.isRunning(projectId)"
            icon="mdi-pause"
            color="warning"
            variant="tonal"
            @click="pauseCrawl"
          />
          <v-btn
            v-if="downloadStore.isPaused(projectId)"
            icon="mdi-play"
            color="success"
            variant="tonal"
            @click="resumeCrawl"
          />
          <v-btn
            v-if="downloadStore.isRunning(projectId) || downloadStore.isPaused(projectId)"
            icon="mdi-stop"
            color="error"
            variant="tonal"
            @click="cancelCrawl"
          />
          <v-btn
            v-if="stats.failed > 0 && !downloadStore.isRunning(projectId) && !downloadStore.isPaused(projectId)"
            icon="mdi-restart"
            color="warning"
            variant="tonal"
            :title="t('progress.retryFailed', { count: stats.failed })"
            @click="retryFailed"
          />
          <v-btn
            icon="mdi-folder-open"
            variant="tonal"
            @click="openOutputDir"
          />
        </div>
      </v-col>
    </v-row>

    <v-snackbar v-model="showActionError" color="error" timeout="3500">
      {{ actionError }}
    </v-snackbar>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDownloadStore } from '../stores/download-store'
import { useProjectStore } from '../stores/project-store'

const { t } = useI18n()
const downloadStore = useDownloadStore()
const projectStore = useProjectStore()

const props = defineProps<{
  projectId: string
}>()

const elapsed = computed(() => downloadStore.getElapsed(props.projectId))
const actionError = ref('')
const showActionError = computed({
  get: () => !!actionError.value,
  set: (val: boolean) => {
    if (!val) actionError.value = ''
  }
})
const stats = computed(() => downloadStore.getStats(props.projectId))

const activeDownloads = computed(() => downloadStore.getActiveFiles(props.projectId))

/**
 * Slot count shown/controlled live: the user's in-crawl override wins, and we
 * fall back to the saved project config before any override is made.
 */
const concurrencyOverride = ref<number | null>(null)
const liveConcurrency = computed(
  () => concurrencyOverride.value ?? projectStore.getProjectById(props.projectId)?.config?.concurrency ?? 4
)

const downloadSlots = computed(() => {
  const slots = [...activeDownloads.value]
  while (slots.length < liveConcurrency.value) {
    slots.push({ url: '', filename: '', percent: 0 })
  }
  return slots.slice(0, liveConcurrency.value)
})

let concurrencyTimer: ReturnType<typeof setTimeout> | null = null

function bumpConcurrency(delta: number): void {
  const next = Math.min(20, Math.max(1, liveConcurrency.value + delta))
  if (next === liveConcurrency.value) return
  concurrencyOverride.value = next
  if (concurrencyTimer) clearTimeout(concurrencyTimer)
  concurrencyTimer = setTimeout(() => {
    downloadStore.setConcurrency(props.projectId, next).catch((err: any) => {
      actionError.value = err?.message || String(err)
    })
  }, 250)
}

const overallPercent = computed(() => {
  const total = stats.value.downloaded + stats.value.queued
  if (total === 0) return 0
  return Math.round((stats.value.downloaded / total) * 100)
})

/**
 * A crawler discovers new URLs as it goes, so "processed / known total" can
 * stay near zero for a long time on large sites even though files keep
 * landing. Treat the run as "discovering" while the known-but-unprocessed
 * queue is still larger than everything finished; the deterministic fill
 * returns once the backlog drains below that point.
 */
const discovering = computed(() => {
  const s = stats.value
  return downloadStore.isRunning(props.projectId) && s.queued > Math.max(20, s.downloaded)
})

const elapsedFormatted = computed(() => {
  const s = elapsed.value
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
})

const typeBreakdown = computed(() => {
  const breakdown = stats.value.byType || {}
  const types = [
    { type: 'html', icon: 'mdi-language-html5', color: 'orange', label: 'HTML' },
    { type: 'css', icon: 'mdi-language-css3', color: 'blue', label: 'CSS' },
    { type: 'js', icon: 'mdi-language-javascript', color: 'yellow-darken-2', label: 'JS' },
    { type: 'image', icon: 'mdi-image', color: 'green', label: t('progress.images') },
    { type: 'font', icon: 'mdi-format-font', color: 'purple', label: t('progress.fonts') },
    { type: 'media', icon: 'mdi-play-circle', color: 'red', label: t('progress.media') },
    { type: 'other', icon: 'mdi-file', color: 'grey', label: t('progress.other') }
  ]
  const totalCount = stats.value.downloaded || 1
  return types.map(t => {
    const data = breakdown[t.type] || { count: 0, bytes: 0 }
    return {
      ...t,
      count: data.count,
      bytes: data.bytes,
      percent: Math.round((data.count / totalCount) * 100)
    }
  })
})

const statusColor = computed(() => {
  if (downloadStore.isRunning(props.projectId)) return 'success'
  if (downloadStore.isPaused(props.projectId)) return 'warning'
  if (downloadStore.isStopped(props.projectId)) return 'orange'
  if (stats.value.downloaded > 0 && stats.value.queued === 0) return 'primary'
  return 'grey'
})

const statusIcon = computed(() => {
  if (downloadStore.isRunning(props.projectId)) return 'mdi-download'
  if (downloadStore.isPaused(props.projectId)) return 'mdi-pause-circle-outline'
  if (downloadStore.isStopped(props.projectId)) return 'mdi-stop-circle-outline'
  if (stats.value.downloaded > 0 && stats.value.queued === 0) return 'mdi-check-circle-outline'
  return 'mdi-clock-outline'
})

const statusLabel = computed(() => {
  if (downloadStore.isRunning(props.projectId)) return t('progress.downloading')
  if (downloadStore.isPaused(props.projectId)) return t('progress.paused')
  if (downloadStore.isStopped(props.projectId)) return t('progress.stopped')
  if (stats.value.downloaded > 0 && stats.value.queued === 0) return t('progress.done')
  return t('progress.idle')
})

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

function formatSpeed(bytesPerSec: number): string {
  const safe = Number(bytesPerSec)
  return `${formatBytes(Number.isFinite(safe) ? safe : 0)}/s`
}

async function pauseCrawl(): Promise<void> {
  try {
    actionError.value = ''
    await downloadStore.pauseCrawl(props.projectId)
  } catch (err: any) {
    actionError.value = err?.message || String(err)
  }
}

async function resumeCrawl(): Promise<void> {
  try {
    actionError.value = ''
    await downloadStore.resumeCrawl(props.projectId)
  } catch (err: any) {
    actionError.value = err?.message || String(err)
  }
}

async function cancelCrawl(): Promise<void> {
  try {
    actionError.value = ''
    await downloadStore.cancelCrawl(props.projectId)
  } catch (err: any) {
    actionError.value = err?.message || String(err)
  }
}

/** Re-queue failed URLs only, then start a crawl to fetch them. */
async function retryFailed(): Promise<void> {
  try {
    actionError.value = ''
    const count = await downloadStore.retryFailed(props.projectId)
    if (count > 0) {
      await downloadStore.startCrawl(props.projectId)
    }
  } catch (err: any) {
    actionError.value = err?.message || String(err)
  }
}

async function openOutputDir(): Promise<void> {
  const dir =
    projectStore.getProjectById(props.projectId)?.outputDir || stats.value.outputDir || ''
  if (!dir) {
    actionError.value = t('progress.noOutputDir')
    return
  }
  try {
    actionError.value = ''
    await window.api.openExternal(dir)
  } catch (err: any) {
    actionError.value = err?.message || String(err)
  }
}

function openDownloadUrl(url: string): void {
  if (!url) return
  window.api.openExternal(url).catch((err: any) => {
    actionError.value = err?.message || String(err)
  })
}
</script>

<style scoped>
.active-download-row {
  cursor: pointer;
  border-radius: 6px;
  padding: 2px 4px;
}

.active-download-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
}

.waiting-download-row {
  border-radius: 6px;
  padding: 2px 4px;
  opacity: 0.75;
}
</style>
