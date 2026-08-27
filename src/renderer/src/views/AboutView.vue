<template>
  <v-container class="py-8 text-center" style="max-width: 600px">
    <img :src="logoUrl" alt="WebScoop" class="about-logo mb-4" />
    <h1 class="sr-only">WebScoop</h1>
    <div class="text-body-1 mb-2">v{{ version }}</div>
    <div class="text-body-2 mb-4">
      <span>{{ t('about.desc') }}</span>
      <br />
      <a href="https://midilli.tech" target="_blank" rel="noopener" class="text-primary font-weight-bold">midilli.tech</a>
    </div>
    <v-divider class="my-4" />
    <div class="text-caption text-grey">&copy; 2026 WebScoop &amp; Midilli.tech</div>
  </v-container>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import logoUrl from '../assets/webscoop.png'
const { t } = useI18n()
const version = __APP_VERSION__ || 'dev'
</script>

<style scoped>
.about-logo {
  height: 96px;
  display: block;
  margin-inline: auto;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
