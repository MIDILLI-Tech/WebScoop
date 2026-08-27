<template>
  <v-card flat>
    <v-row class="mx-0">
      <v-col cols="12" class="pl-12">
        <v-switch
          v-model="model.enabled"
          :label="t('schedule.enable')"
          color="primary"
          hide-details
        />
      </v-col>

      <template v-if="model.enabled">
        <v-col cols="12">
          <v-select
            v-model="presetCron"
            :label="t('schedule.frequency')"
            :items="cronPresets"
            @update:model-value="applyCronPreset"
          />
        </v-col>

        <v-col cols="12">
          <v-text-field
            v-model="model.cron"
            :label="t('schedule.cronExpression')"
            :hint="t('schedule.cronHint')"
            persistent-hint
            placeholder="0 */6 * * *"
            prepend-inner-icon="mdi-clock-outline"
          />
        </v-col>

        <v-col cols="12" v-if="nextRunText">
          <v-alert type="info" variant="tonal" density="compact">
            {{ t('schedule.nextRun') }}: {{ nextRunText }}
          </v-alert>
        </v-col>

        <v-col cols="12">
          <v-switch
            v-model="model.incrementalOnly"
            :label="t('schedule.incrementalOnly')"
            :hint="t('schedule.incrementalHint')"
            persistent-hint
            color="primary"
          />
        </v-col>
      </template>
    </v-row>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

interface ScheduleModel {
  enabled: boolean
  cron: string
  incrementalOnly: boolean
}

const model = defineModel<ScheduleModel>({ required: true })

defineProps<{
  projectId: string
}>()

const presetCron = ref('')

const cronPresets = computed(() => [
  { title: t('schedule.everyHour'), value: '0 * * * *' },
  { title: t('schedule.every6Hours'), value: '0 */6 * * *' },
  { title: t('schedule.daily'), value: '0 2 * * *' },
  { title: t('schedule.weekly'), value: '0 2 * * 1' },
  { title: t('schedule.monthly'), value: '0 2 1 * *' },
  { title: t('schedule.custom'), value: 'custom' }
])

const nextRunText = computed(() => {
  if (!model.value.cron) return ''
  try {
    // Parse simple cron for display
    const parts = model.value.cron.split(/\s+/)
    if (parts.length !== 5) return ''
    const [min, hour, dom, mon, dow] = parts
    if (hour === '*' && min === '0') return t('schedule.everyHour')
    if (hour.startsWith('*/')) return t('schedule.every6Hours')
    if (dom === '*' && mon === '*' && dow === '*') return `${t('schedule.daily')} ${hour}:${min.padStart(2, '0')}`
    if (dow === '1') return `${t('schedule.weekly')} ${hour}:${min.padStart(2, '0')}`
    if (dom === '1') return `${t('schedule.monthly')} ${hour}:${min.padStart(2, '0')}`
    return model.value.cron
  } catch {
    return model.value.cron
  }
})

function applyCronPreset(value: string): void {
  if (value !== 'custom') {
    model.value.cron = value
  }
}

watch(() => model.value.cron, (val) => {
  const match = cronPresets.value.find(p => p.value === val)
  presetCron.value = match ? match.value : 'custom'
}, { immediate: true })
</script>
