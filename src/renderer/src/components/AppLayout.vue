<template>
  <v-layout class="fill-height">
    <!-- Sidebar -->
    <v-navigation-drawer
      v-model="drawer"
      :width="250"
      permanent
      class="border-e"
    >
      <div class="pa-3">
        <div class="mb-3">
          <img :src="logoUrl" alt="WebScoop" class="app-logo" />
        </div>

        <v-btn
          color="primary"
          block
          prepend-icon="mdi-plus"
          @click="createNewProject"
          class="mb-3"
        >
          {{ t('sidebar.newProject') }}
        </v-btn>
      </div>

      <Sidebar />

      <!-- Bottom: Settings and About links -->
      <template #append>
        <v-divider />
        <v-list density="compact">
          <v-list-item
            prepend-icon="mdi-cog-outline"
            :title="t('settings.title')"
            @click="router.push('/settings')"
            :active="route.path === '/settings'"
          />
          <v-list-item
            prepend-icon="mdi-information-outline"
            :title="t('about.title')"
            @click="router.push('/about')"
            :active="route.path === '/about'"
          />
        </v-list>
      </template>
    </v-navigation-drawer>

    <!-- Main content -->
    <v-main class="fill-height" style="overflow-y: auto">
      <router-view />
    </v-main>
  </v-layout>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useProjectStore } from '../stores/project-store'
import Sidebar from './Sidebar.vue'
import logoUrl from '../assets/webscoop.png'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const projectStore = useProjectStore()
const drawer = ref(true)

async function createNewProject(): Promise<void> {
  try {
    // Reuse an untouched blank project instead of piling up "New Project"
    // rows when the button is clicked repeatedly.
    await projectStore.loadProjects()
    const blank = projectStore.projects.find(
      (p) => p.name === 'New Project' && (p.url === 'https://' || p.url === '') && p.status === 'idle'
    )
    const project = blank ?? (await projectStore.createProject({
      name: 'New Project',
      url: 'https://',
      // Keep empty so DownloadForm can derive baseDir from settings.defaultOutputDir correctly.
      outputDir: ''
    }))
    router.push(`/project/${project.id}`)
  } catch (err) {
    console.error('Failed to create project:', err)
  }
}
</script>

<style scoped>
.app-logo {
  height: 40px;
  display: block;
}
</style>
