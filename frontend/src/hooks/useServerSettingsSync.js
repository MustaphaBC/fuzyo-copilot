import { useEffect, useRef } from 'react'
import { useChatControls } from '../context/ChatContext'
import { usePreferences } from '../context/PreferencesContext'
import { applyUserSettings, fetchUserSettings } from '../lib/userSettings'

/** Apply the user's saved server settings once per session (only if a row exists). */
export function useServerSettingsSync() {
  const { setAppearance, setDensity } = usePreferences()
  const { setForceConfidential, setSdlcPhase } = useChatControls()
  const settersRef = useRef({ setAppearance, setDensity, setForceConfidential, setSdlcPhase })

  useEffect(() => {
    settersRef.current = { setAppearance, setDensity, setForceConfidential, setSdlcPhase }
  })

  useEffect(() => {
    let cancelled = false
    fetchUserSettings()
      .then((result) => {
        if (cancelled || !result.persisted || !result.updatedAt) return
        applyUserSettings(result.settings, settersRef.current)
      })
      .catch(() => {
        /* offline or migration 07 missing: keep local preferences */
      })
    return () => {
      cancelled = true
    }
  }, [])
}
