import { apiFetch } from '../lib/api'

export function notifyWorkspaceFsUpdated(workspaceId) {
  if (typeof window === 'undefined' || !workspaceId) return
  window.dispatchEvent(
    new CustomEvent('fuzyo:workspace-fs-updated', {
      detail: { workspaceId },
    }),
  )
}

export async function saveArtifactToLocalPc({
  workspaceId,
  fileName,
  content,
  phase,
}) {
  const response = await apiFetch(`/api/v1/workspaces/${workspaceId}/save-artifact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_name: fileName,
      content: content || '',
      phase: phase || 1,
    }),
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || `Save failed (${response.status})`)
  }
  const json = await response.json()
  notifyWorkspaceFsUpdated(workspaceId)
  return json
}

export function defaultArtifactFileName(language) {
  const lang = (language || '').toLowerCase()
  const extMap = {
    javascript: 'js',
    js: 'js',
    jsx: 'jsx',
    typescript: 'ts',
    ts: 'ts',
    tsx: 'tsx',
    python: 'py',
    py: 'py',
    go: 'go',
    json: 'json',
    yaml: 'yml',
    yml: 'yml',
    sql: 'sql',
    markdown: 'md',
    md: 'md',
    mermaid: 'mermaid',
    csv: 'csv',
    toml: 'toml',
    text: 'txt',
    txt: 'txt',
  }
  const ext = extMap[lang] || 'md'
  if (lang === 'mermaid') return 'architecture_diagram.mermaid'
  return `assistant-snippet.${ext}`
}
