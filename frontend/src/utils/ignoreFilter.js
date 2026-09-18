/** Path ignore rules for codebase import (client + shared test). */

const IGNORE_SEGMENTS = [
  'node_modules/',
  '.git/',
  '.venv/',
  'dist/',
  '__pycache__/',
]

/**
 * Return true if the path should be skipped during codebase import.
 * @param {string} relativePath
 */
export function shouldIgnorePath(relativePath) {
  const normalized = String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')

  if (!normalized) return true

  const lower = normalized.toLowerCase()
  const base = lower.split('/').pop() || ''

  if (base === '.env' || base.startsWith('.env.')) return true

  for (const segment of IGNORE_SEGMENTS) {
    if (lower.includes(segment) || lower.startsWith(segment.slice(0, -1) + '/') || lower === segment.slice(0, -1)) {
      return true
    }
    // also match segment without trailing slash as path component
    const bare = segment.replace(/\/$/, '')
    const parts = lower.split('/')
    if (parts.includes(bare)) return true
  }

  return false
}

/**
 * Filter a list of relative paths, keeping only ingestible ones.
 * @param {string[]} paths
 */
export function filterIgnoredPaths(paths) {
  return (paths || []).filter((p) => !shouldIgnorePath(p))
}
