export function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore quota */
  }
}

export function threadsKey(workspaceId) {
  return `fuzyo:threads:${workspaceId || 'none'}`
}

export function messagesKey(threadId) {
  return `fuzyo:messages:${threadId}`
}

export function artifactsKey(workspaceId) {
  return `fuzyo:artifacts:${workspaceId || 'none'}`
}

export function aiBehaviorKey(workspaceId) {
  return `fuzyo:ai-behavior:${workspaceId || 'none'}`
}
