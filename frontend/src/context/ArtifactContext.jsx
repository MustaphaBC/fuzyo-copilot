import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'

const ArtifactContext = createContext(null)

export function ArtifactProvider({ children }) {
  const [activeArtifact, setActiveArtifact] = useState(null)
  const [isOpen, setIsOpen] = useState(false)

  const openArtifact = useCallback((artifactData) => {
    if (!artifactData) return
    setActiveArtifact({
      type: artifactData.type || 'mermaid',
      title: artifactData.title || 'Artifact',
      content: artifactData.content || '',
    })
    setIsOpen(true)
  }, [])

  const closeArtifact = useCallback(() => {
    setIsOpen(false)
    setActiveArtifact(null)
  }, [])

  const value = useMemo(
    () => ({
      activeArtifact,
      isOpen,
      openArtifact,
      closeArtifact,
    }),
    [activeArtifact, isOpen, openArtifact, closeArtifact],
  )

  return (
    <ArtifactContext.Provider value={value}>{children}</ArtifactContext.Provider>
  )
}

export function useArtifact() {
  const ctx = useContext(ArtifactContext)
  if (!ctx) {
    throw new Error('useArtifact must be used within ArtifactProvider')
  }
  return ctx
}
