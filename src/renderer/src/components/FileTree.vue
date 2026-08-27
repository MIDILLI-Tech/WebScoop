<template>
  <v-card flat class="pa-4">
    <div class="d-flex align-center mb-3">
      <v-text-field
        v-model="search"
        :label="t('fileTree.search')"
        prepend-inner-icon="mdi-magnify"
        density="compact"
        hide-details
        clearable
        class="flex-grow-1 mr-2"
      />
      <v-btn icon="mdi-open-in-new" variant="text" @click="openIndexInBrowser" :title="t('fileTree.openInBrowser')" />
      <v-btn icon="mdi-folder-open" variant="text" @click="openRootDir" :title="t('fileTree.openFolder')" />
      <v-btn icon="mdi-refresh" variant="text" @click="refreshTree" :title="t('common.refresh')" />
    </div>

    <!-- Summary -->
    <div class="d-flex ga-4 text-caption text-grey mb-3">
      <span>{{ t('fileTree.fileCount', { count: totalFiles }) }}</span>
      <span>{{ formatBytes(totalSize) }}</span>
    </div>

    <!-- Flat tree list -->
    <div v-if="tree.length > 0" class="file-tree-list">
      <div
        v-for="row in flatNodes"
        :key="row.path"
        class="d-flex align-center py-1 pr-2 tree-row"
        :style="{ paddingLeft: row.indent + 'px', cursor: row.isDir ? 'pointer' : 'default' }"
        @click="row.isDir ? toggleExpand(row.path) : undefined"
      >
        <!-- Directory row -->
        <template v-if="row.isDir">
          <v-icon :icon="expandedDirs.has(row.path) ? 'mdi-chevron-down' : 'mdi-chevron-right'" size="16" class="mr-1" />
          <v-icon icon="mdi-folder" color="amber" size="18" class="mr-2" />
          <span class="text-body-2 flex-grow-1">{{ row.name }}</span>
          <v-btn
            icon="mdi-folder-open-outline"
            variant="text"
            size="x-small"
            :title="t('fileTree.openFolder')"
            @click.stop="openFolder(row.path)"
          />
        </template>
        <!-- File row -->
        <template v-else>
          <v-icon :icon="getFileIcon(row.name)" color="grey" size="18" class="mr-2" />
          <span class="text-body-2 flex-grow-1 text-truncate">{{ row.name }}</span>
          <span class="text-caption text-grey mono mr-2">{{ formatBytes(row.size) }}</span>
          <v-btn icon="mdi-open-in-new" variant="text" size="x-small" @click.stop="openFile(row.path)" />
        </template>
      </div>
    </div>

    <v-card v-else variant="tonal" class="pa-6 text-center">
      <v-icon icon="mdi-folder-open-outline" size="48" color="grey" class="mb-2" />
      <div class="text-body-2 text-grey">{{ t('fileTree.empty') }}</div>
    </v-card>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  projectId: string
  outputDir: string
}>()

interface TreeNode {
  name: string
  path: string
  isDir: boolean
  size: number
  children?: TreeNode[]
}

interface FlatNode {
  name: string
  path: string
  isDir: boolean
  size: number
  indent: number
  hasChildren: boolean
}

const tree = ref<TreeNode[]>([])
const search = ref('')
const totalFiles = ref(0)
const totalSize = ref(0)
const loading = ref(false)
const expandedDirs = ref<Set<string>>(new Set())

const filteredTree = computed(() => {
  if (!search.value) return tree.value
  return filterTree(tree.value, search.value.toLowerCase())
})

/** Flatten tree into a linear list, respecting expanded state */
const flatNodes = computed(() => {
  const result: FlatNode[] = []
  function walk(nodes: TreeNode[], depth: number): void {
    for (const node of nodes) {
      const indent = node.isDir ? 8 + depth * 24 : 8 + depth * 24 + 24
      result.push({
        name: node.name,
        path: node.path,
        isDir: node.isDir,
        size: node.size,
        indent,
        hasChildren: !!(node.children && node.children.length > 0)
      })
      if (node.isDir && expandedDirs.value.has(node.path) && node.children) {
        walk(node.children, depth + 1)
      }
    }
  }
  walk(filteredTree.value, 0)
  return result
})

function toggleExpand(path: string): void {
  if (expandedDirs.value.has(path)) {
    expandedDirs.value.delete(path)
  } else {
    expandedDirs.value.add(path)
  }
}

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  return nodes.reduce<TreeNode[]>((acc, node) => {
    if (node.isDir) {
      const children = filterTree(node.children || [], query)
      if (children.length > 0) acc.push({ ...node, children })
    } else if (node.name.toLowerCase().includes(query)) {
      acc.push(node)
    }
    return acc
  }, [])
}

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  const icons: Record<string, string> = {
    html: 'mdi-language-html5', htm: 'mdi-language-html5',
    css: 'mdi-language-css3',
    js: 'mdi-language-javascript', mjs: 'mdi-language-javascript',
    json: 'mdi-code-json',
    png: 'mdi-image', jpg: 'mdi-image', jpeg: 'mdi-image', gif: 'mdi-image', svg: 'mdi-image', webp: 'mdi-image',
    pdf: 'mdi-file-pdf-box',
    mp4: 'mdi-video', webm: 'mdi-video',
    mp3: 'mdi-music', wav: 'mdi-music',
    woff: 'mdi-format-font', woff2: 'mdi-format-font', ttf: 'mdi-format-font', eot: 'mdi-format-font',
    zip: 'mdi-zip-box', gz: 'mdi-zip-box',
    xml: 'mdi-xml', txt: 'mdi-text-box'
  }
  return icons[ext || ''] || 'mdi-file-outline'
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

async function refreshTree(): Promise<void> {
  loading.value = true
  try {
    const data = await window.api.getProjectFiles(props.projectId)
    if (data) {
      tree.value = data.tree
      totalFiles.value = data.totalFiles
      totalSize.value = data.totalSize
      // Auto-expand root-level directories
      for (const node of data.tree) {
        if (node.isDir) expandedDirs.value.add(node.path)
      }
    }
  } finally {
    loading.value = false
  }
}

function openRootDir(): void {
  if (props.outputDir) window.api.openExternal(props.outputDir)
}

function openFolder(folderPath: string): void {
  window.api.openExternal(folderPath)
}

function openFile(filePath: string): void {
  window.api.openExternal(filePath)
}

function openIndexInBrowser(): void {
  if (!props.outputDir) return
  // Find the first HTML file (index.html) in the output directory
  const findIndex = (nodes: TreeNode[]): string | null => {
    for (const node of nodes) {
      if (!node.isDir && /^index\.html?$/i.test(node.name)) return node.path
    }
    // Check subdirectories if not found at root
    for (const node of nodes) {
      if (node.isDir && node.children) {
        const found = findIndex(node.children)
        if (found) return found
      }
    }
    return null
  }
  const indexPath = findIndex(tree.value)
  if (indexPath) {
    window.api.openInBrowser(indexPath)
  } else if (tree.value.length > 0) {
    // Fallback: open the first file
    const firstFile = tree.value.find(n => !n.isDir)
    if (firstFile) window.api.openInBrowser(firstFile.path)
  }
}

onMounted(refreshTree)
watch(() => props.projectId, refreshTree)
</script>

<style scoped>
.tree-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 4px;
}
.file-tree-list {
  max-height: 500px;
  overflow-y: auto;
}
</style>
