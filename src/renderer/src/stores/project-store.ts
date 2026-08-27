import { defineStore } from 'pinia'
import { ref } from 'vue'

interface CrawlProject {
  id: string
  name: string
  url: string
  outputDir: string
  status: string
  config: any
  stats: any
  schedule?: any
  createdAt: string
  updatedAt: string
}

export const useProjectStore = defineStore('projects', () => {
  const projects = ref<CrawlProject[]>([])
  const currentProject = ref<CrawlProject | null>(null)
  const loading = ref(false)

  async function loadProjects(): Promise<void> {
    loading.value = true
    try {
      projects.value = await window.api.getProjects()
    } finally {
      loading.value = false
    }
  }

  async function loadProject(id: string): Promise<CrawlProject | null> {
    const project = await window.api.getProject(id)
    currentProject.value = project
    if (project) {
      // Keep the list row in sync (status/outputDir change after a crawl).
      const idx = projects.value.findIndex((p) => p.id === id)
      if (idx >= 0) projects.value[idx] = project
    }
    return project
  }

  async function createProject(data: Partial<CrawlProject>): Promise<CrawlProject> {
    const project = await window.api.createProject(data)
    projects.value.unshift(project)
    currentProject.value = project
    return project
  }

  async function updateProject(id: string, updates: Partial<CrawlProject>): Promise<void> {
    const project = await window.api.updateProject(id, updates)
    const idx = projects.value.findIndex((p) => p.id === id)
    if (idx >= 0) projects.value[idx] = project
    if (currentProject.value?.id === id) currentProject.value = project
  }

  async function deleteProject(id: string): Promise<void> {
    await window.api.deleteProject(id)
    projects.value = projects.value.filter((p) => p.id !== id)
    if (currentProject.value?.id === id) currentProject.value = null
  }

  function getProjectById(id: string): CrawlProject | undefined {
    return projects.value.find((p) => p.id === id)
  }

  return {
    projects,
    currentProject,
    loading,
    loadProjects,
    loadProject,
    createProject,
    updateProject,
    deleteProject,
    getProjectById
  }
})
