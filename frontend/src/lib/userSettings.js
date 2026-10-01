import { apiFetch } from './api'

export const DEFAULT_USER_SETTINGS = {
  appearance: 'system',
  density: 'comfortable',
  privacy_mode: 'auto',
  default_sdlc_phase: 1,
  auto_open_inspector: true,
  auto_open_canvas: true,
}

const CHAT_PREFS_KEY = 'fuzyo:chat-prefs'

export function readChatPrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_PREFS_KEY) || '{}')
    return {
      autoOpenInspector: parsed.autoOpenInspector !== false,
      autoOpenCanvas: parsed.autoOpenCanvas !== false,
    }
  } catch {
    return { autoOpenInspector: true, autoOpenCanvas: true }
  }
}

export function writeChatPrefs(settings) {
  try {
    localStorage.setItem(
      CHAT_PREFS_KEY,
      JSON.stringify({
        autoOpenInspector: Boolean(settings.auto_open_inspector),
        autoOpenCanvas: Boolean(settings.auto_open_canvas),
      }),
    )
  } catch {
    /* storage unavailable */
  }
}

export async function fetchUserSettings() {
  const response = await apiFetch('/api/v1/me/settings')
  if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`)
  const data = await response.json()
  return {
    settings: { ...DEFAULT_USER_SETTINGS, ...(data.settings || {}) },
    persisted: Boolean(data.persisted),
    updatedAt: data.updated_at || null,
  }
}

export async function saveUserSettings(settings) {
  const response = await apiFetch('/api/v1/me/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`)
  const data = await response.json()
  return { settings: data.settings, persisted: Boolean(data.persisted), updatedAt: data.updated_at }
}

/** Push server settings into the running app (theme, density, privacy, phase, chat prefs). */
export function applyUserSettings(settings, app) {
  app.setAppearance(settings.appearance)
  app.setDensity(settings.density)
  app.setForceConfidential(settings.privacy_mode === 'confidential')
  app.setSdlcPhase(Number(settings.default_sdlc_phase) || 1)
  writeChatPrefs(settings)
}
