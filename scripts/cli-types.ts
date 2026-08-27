export interface UrlStatusRow {
  status: string
  parentUrl: string | null
  depth: number
  error?: string
}
