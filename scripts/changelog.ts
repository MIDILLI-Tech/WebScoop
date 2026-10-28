import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface Commit {
  prefix: string
  message: string
}

interface SectionMap {
  Added: string[]
  Fixed: string[]
  Security: string[]
  Performance: string[]
  Changed: string[]
  Documentation: string[]
  Testing: string[]
  Deprecated: string[]
  Removed: string[]
}

function info(msg: string): void {
  console.error(`[changelog] ${msg}`)
}

function err(msg: string): never {
  console.error(`[changelog] ERROR: ${msg}`)
  process.exit(1)
}

function getArg(name: string): string | undefined {
  const args = process.argv.slice(2)
  const eq = args.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const idx = args.indexOf(`--${name}`)
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1]
  return undefined
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`)
}

function gitExec(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return ''
  }
}

function lastTag(currentTag: string): string {
  let tag = gitExec(['describe', '--tags', '--abbrev=0']).trim()
  if (tag === '' || tag.startsWith('fatal:') || tag.includes('No names found')) tag = ''

  if (tag === '' || tag === currentTag) {
    const list = gitExec(['tag', '--sort=-version:refname'])
    for (const line of list.split(/\r?\n/)) {
      const t = line.trim()
      if (t !== '' && !t.startsWith('fatal:') && t !== currentTag) {
        tag = t
        break
      }
    }
  }
  return tag
}

function parseCommits(logOutput: string): Commit[] {
  const commits: Commit[] = []
  const entries = logOutput.split('\u001d').filter((e) => e.trim() !== '')

  for (const entry of entries) {
    const parts = entry.split('\u001e')
    const body = parts.length > 1 ? parts.slice(1).join('\u001e') : parts[0]
    const firstLine = body.trim().split(/\r?\n/)[0]?.trim() ?? ''
    if (firstLine === '') continue
    if (/^Merge/i.test(firstLine)) continue

    const m = firstLine.match(/^(fix|feat|add|chore|refactor|docs|test|perf|security|deprecate|remove)(?:\([^)]*\))?:\s*(.+)$/i)
    if (!m) continue

    let message = m[2].trim()
    message = message.replace(/^\s*Signed-off-by:.*$/gim, '').trim()
    if (message === '') continue

    commits.push({ prefix: m[1].toLowerCase(), message })
  }

  return commits
}

function generateChangelog(
  rootDir: string,
  version: string,
  tagName: string,
  description: string
): string {
  const tag = lastTag(tagName)
  let logOutput: string
  if (tag === '') {
    info('No previous tags found - using all commits.')
    logOutput = gitExec(['log', '--format=%H%x1e%B%x1d', '--no-merges'])
  } else {
    info(`Using commits since ${tag}.`)
    logOutput = gitExec(['log', `${tag}..HEAD`, '--format=%H%x1e%B%x1d', '--no-merges'])
  }

  const commits = logOutput.trim() === '' ? [] : parseCommits(logOutput)
  if (commits.length === 0) info('No conventional commits found.')

  const sections: SectionMap = {
    Added: [],
    Fixed: [],
    Security: [],
    Performance: [],
    Changed: [],
    Documentation: [],
    Testing: [],
    Deprecated: [],
    Removed: []
  }

  const seen: Record<string, boolean> = {}
  for (const commit of commits) {
    if (seen[commit.message]) continue
    seen[commit.message] = true
    const bullet = `- ${commit.message}`
    switch (commit.prefix) {
      case 'feat':
      case 'add':
        sections.Added.push(bullet)
        break
      case 'fix':
        sections.Fixed.push(bullet)
        break
      case 'security':
        sections.Security.push(bullet)
        break
      case 'perf':
        sections.Performance.push(bullet)
        break
      case 'refactor':
      case 'chore':
        sections.Changed.push(bullet)
        break
      case 'docs':
        sections.Documentation.push(bullet)
        break
      case 'test':
        sections.Testing.push(bullet)
        break
      case 'deprecate':
        sections.Deprecated.push(bullet)
        break
      case 'remove':
        sections.Removed.push(bullet)
        break
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const lines: string[] = []
  lines.push(`## [${version}] - ${today}`)
  lines.push('')

  if (description !== '') {
    lines.push(description)
    lines.push('')
  }

  let hasContent = false
  for (const [name, items] of Object.entries(sections)) {
    if (items.length === 0) continue
    hasContent = true
    lines.push(`### ${name}`)
    for (const item of items) lines.push(item)
    lines.push('')
  }

  if (!hasContent) {
    lines.push('### Added')
    lines.push('- Initial release')
    lines.push('')
  }

  return lines.join('\n').replace(/\n+$/, '')
}

function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, ' ')
}

function mergeChangelogSections(existingContent: string, newSection: string, version: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const heading = `## [${version}] - ${today}`

  const existingMatch = existingContent.match(new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\].*?(?=^## \\[|\\z)`, 'ms'))
  if (!existingMatch) {
    return `${heading}\n${newSection.replace(/^## [^\n]*\n/, '')}`
  }

  const existingSection = existingMatch[0]
  const existingBody = existingSection.replace(/^## \[[^\]]*\][^\n]*\n/, '').trimEnd()

  const manualEntries: string[] = []
  const autoLines: string[] = []
  let inAutoSection = false
  for (const line of existingBody.split('\n')) {
    if (/^### /.test(line)) {
      inAutoSection = true
      autoLines.push(line)
    } else if (inAutoSection && /^- /.test(line)) {
      autoLines.push(line)
    } else if (line.trim() === '') {
      autoLines.push(line)
    } else {
      inAutoSection = false
      manualEntries.push(line)
    }
  }

  let newDescription = ''
  const newSections: Record<string, string[]> = {}
  let currentSection: string | null = null
  let beforeFirstSection = true
  for (const line of newSection.split('\n')) {
    if (/^## /.test(line)) continue
    if (/^### /.test(line)) {
      beforeFirstSection = false
      currentSection = line.trim()
      newSections[currentSection] = []
    } else if (currentSection !== null && /^- /.test(line)) {
      newSections[currentSection].push(line)
    } else if (beforeFirstSection && line.trim() !== '') {
      newDescription += (newDescription !== '' ? '\n' : '') + line
    }
  }

  const mergedLines: string[] = []
  const seen: Record<string, boolean> = {}
  mergedLines.push(heading)
  mergedLines.push('')
  if (newDescription !== '') {
    mergedLines.push(newDescription)
    mergedLines.push('')
  }
  for (const [sectionName, items] of Object.entries(newSections)) {
    mergedLines.push(sectionName)
    for (const item of items) {
      mergedLines.push(item)
      seen[normalizeLine(item)] = true
    }
    mergedLines.push('')
  }
  for (const line of autoLines) {
    if (line.trim() === '') {
      if (mergedLines.length > 0 && mergedLines[mergedLines.length - 1] !== '') mergedLines.push('')
    } else if (seen[normalizeLine(line)]) {
      continue
    } else {
      mergedLines.push(line)
      if (/^- /.test(line)) seen[normalizeLine(line)] = true
    }
  }
  if (manualEntries.length > 0) {
    mergedLines.push('')
    mergedLines.push('<!-- manual entries below -->')
    mergedLines.push(...manualEntries)
  }

  return mergedLines.join('\n')
}

function main(): void {
  const version = getArg('version')
  if (!version) err('--version is required')
  if (!/^\d+\.\d+\.\d+/.test(version)) err(`Version "${version}" does not look like semver (x.y.z).`)

  const description = getArg('description') ?? ''
  const force = hasFlag('force')
  const dryRun = hasFlag('dry-run')
  const tagName = `v${version}`
  const rootDir = process.cwd()
  const changelogPath = join(rootDir, 'CHANGELOG.md')

  info(`Version: ${version}`)
  info(`Tag: ${tagName}`)
  info(`Dry run: ${dryRun ? 'YES' : 'no'}`)

  const section = generateChangelog(rootDir, version, tagName, description)

  if (dryRun) {
    info('Generated changelog section:')
    console.log(section)
    return
  }

  if (!existsSync(changelogPath)) err('CHANGELOG.md not found.')

  const existing = readFileSync(changelogPath, 'utf8')
  const newHeading = `## [${version}]`

  let updated: string
  if (existing.includes(newHeading)) {
    if (force) info(`Overwriting existing section for [${version}].`)
    else info(`Section [${version}] exists - merging new entries.`)
    const merged = mergeChangelogSections(existing, section, version)
    updated = existing.replace(
      new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\].*?(?=^## \\[|\\z)`, 'ms'),
      `${merged.trimEnd()}\n\n`
    )
  } else {
    const headerMatch = existing.match(/^(.*?)(?=^## \[)/ms)
    let header = ''
    let rest = existing
    if (headerMatch) {
      header = headerMatch[1].trimEnd() + '\n\n'
      rest = existing.replace(/^(.*?)(?=^## \[)/ms, '')
    }
    updated = `${header}${section}\n\n${rest}`
  }

  writeFileSync(changelogPath, updated, 'utf8')
  info('CHANGELOG.md updated.')
}

main()
