<template>
  <v-card flat class="pa-3">
    <!-- Toolbar -->
    <div class="d-flex align-center mb-2">
      <v-btn-toggle v-model="levelFilter" multiple density="compact" variant="outlined" class="mr-3">
        <v-btn value="info" size="small" color="info">
          <v-icon icon="mdi-information" start size="16" /> Info
        </v-btn>
        <v-btn value="warn" size="small" color="warning">
          <v-icon icon="mdi-alert" start size="16" /> Warn
        </v-btn>
        <v-btn value="error" size="small" color="error">
          <v-icon icon="mdi-alert-circle" start size="16" /> Error
        </v-btn>
      </v-btn-toggle>

      <v-text-field
        v-model="search"
        :label="t('log.search')"
        prepend-inner-icon="mdi-magnify"
        density="compact"
        hide-details
        clearable
        class="flex-grow-1 mr-2"
      />

      <v-btn icon="mdi-content-copy" variant="text" size="small" @click="copyLogs" :title="t('log.copy')" />
      <v-btn icon="mdi-download" variant="text" size="small" @click="exportLogs" :title="t('log.export')" />
      <v-btn icon="mdi-delete-outline" variant="text" size="small" @click="clearLogs" :title="t('log.clear')" />
      <v-switch
        v-model="autoScroll"
        :label="t('log.autoScroll')"
        density="compact"
        hide-details
        class="ml-2 flex-shrink-0"
      />
    </div>

    <!-- Stats bar -->
    <div class="d-flex ga-4 text-caption mb-2">
      <span>
        <v-icon icon="mdi-information" size="14" color="info" /> {{ infoCount }}
      </span>
      <span>
        <v-icon icon="mdi-alert" size="14" color="warning" /> {{ warnCount }}
      </span>
      <span>
        <v-icon icon="mdi-alert-circle" size="14" color="error" /> {{ errorCount }}
      </span>
      <span class="text-grey">{{ t('log.total', { count: filteredLogs.length }) }}</span>
    </div>

    <!-- Log container with virtual scroll -->
    <v-virtual-scroll
      ref="scrollContainer"
      :items="filteredLogs"
      :item-height="28"
      height="400"
      class="log-container"
    >
      <template #default="{ item }">
        <div class="log-entry d-flex align-center" :class="`log-${item.level}`">
          <span class="log-time mono text-grey mr-2">{{ formatTime(item.timestamp) }}</span>
          <v-icon
            :icon="levelIcon(item.level)"
            :color="levelColor(item.level)"
            size="14"
            class="mr-1"
          />
          <span class="text-caption text-truncate" :title="item.message">{{ item.message }}</span>
          <span v-if="item.url" class="text-caption text-grey ml-auto text-truncate" style="max-width: 200px" :title="item.url">
            {{ item.url }}
          </span>
        </div>
      </template>
    </v-virtual-scroll>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDownloadStore } from '../stores/download-store'

const { t } = useI18n()
const downloadStore = useDownloadStore()

const props = defineProps<{
  projectId: string
}>()

const levelFilter = ref(['info', 'warn', 'error'])
const search = ref('')
const autoScroll = ref(true)
const scrollContainer = ref<any>(null)

const logs = computed(() => downloadStore.getLogs(props.projectId))

const filteredLogs = computed(() => {
  let result = logs.value.filter(l => levelFilter.value.includes(l.level))
  if (search.value) {
    const q = search.value.toLowerCase()
    result = result.filter(l => l.message.toLowerCase().includes(q) || (l.url && l.url.toLowerCase().includes(q)))
  }
  return result
})

const infoCount = computed(() => logs.value.filter(l => l.level === 'info').length)
const warnCount = computed(() => logs.value.filter(l => l.level === 'warn').length)
const errorCount = computed(() => logs.value.filter(l => l.level === 'error').length)

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString()
}

function levelIcon(level: string): string {
  return level === 'error' ? 'mdi-alert-circle' : level === 'warn' ? 'mdi-alert' : 'mdi-information'
}

function levelColor(level: string): string {
  return level === 'error' ? 'error' : level === 'warn' ? 'warning' : 'info'
}

function copyLogs(): void {
  const text = filteredLogs.value.map(l => `[${formatTime(l.timestamp)}] [${l.level}] ${l.message}`).join('\n')
  navigator.clipboard.writeText(text)
}

function exportLogs(): void {
  const text = filteredLogs.value.map(l => `[${formatTime(l.timestamp)}] [${l.level}] ${l.message} ${l.url || ''}`).join('\n')
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `webscoop-log-${Date.now()}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

function clearLogs(): void {
  downloadStore.clearLogs(props.projectId)
  window.api.clearProjectLogs(props.projectId).catch(() => {})
}

// Seed from SQLite so logs survive renderer reloads / app restarts
onMounted(() => {
  downloadStore.loadPersistedLogs(props.projectId)
})
watch(
  () => props.projectId,
  (id) => {
    downloadStore.loadPersistedLogs(id)
  }
)

watch(
  () => logs.value.length,
  async () => {
    if (autoScroll.value && scrollContainer.value) {
      await nextTick()
      scrollContainer.value.$el.scrollTop = scrollContainer.value.$el.scrollHeight
    }
  }
)
</script>

<style scoped>
.log-container {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.12);
  border-radius: 4px;
}
.log-entry {
  padding: 2px 8px;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.06);
}
.log-entry:hover {
  background: rgba(var(--v-theme-primary), 0.04);
}
.log-time {
  font-size: 11px;
  min-width: 80px;
}
.log-error { color: rgb(var(--v-theme-error)); }
.log-warn { color: rgb(var(--v-theme-warning)); }
</style>
