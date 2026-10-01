import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { saveArtifactToLocalPc } from '../lib/saveLocalArtifact'
import { useWorkspace } from './WorkspaceContext'

const EditorContext = createContext(null)

const LANGUAGE_BY_EXTENSION = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  go: 'go',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sql: 'sql',
  css: 'css',
  html: 'html',
  txt: 'plaintext',
  mermaid: 'plaintext',
}

function languageFromPath(path) {
  const name = String(path || '').split('/').pop() || ''
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
  return LANGUAGE_BY_EXTENSION[ext] || 'plaintext'
}

function normalizePath(path) {
  return String(path || '').replace(/\\/g, '/')
}

export function EditorProvider({ children }) {
  const { activeWorkspace } = useWorkspace()
  const activeWorkspaceId = activeWorkspace?.id || null
  const [openFiles, setOpenFiles] = useState([])
  const [activeFilePath, setActiveFilePath] = useState(null)
  const [pendingDiff, setPendingDiffState] = useState(null)

  const openIdeFile = useCallback((file) => {
    const path = normalizePath(file?.path)
    if (!path) return
    setOpenFiles((prev) => {
      const existing = prev.find((f) => f.path === path)
      if (existing) return prev
      return [
        ...prev,
        {
          path,
          content: file?.content ?? '',
          dirty: false,
          language: file?.language || languageFromPath(path),
        },
      ]
    })
    setActiveFilePath(path)
  }, [])

  const closeIdeFile = useCallback((path) => {
    const target = normalizePath(path)
    setOpenFiles((prev) => {
      const next = prev.filter((f) => f.path !== target)
      setActiveFilePath((current) => {
        if (current !== target) return current
        return next.length ? next[next.length - 1].path : null
      })
      return next
    })
  }, [])

  const setActiveFile = useCallback((path) => {
    setActiveFilePath(path ? normalizePath(path) : null)
  }, [])

  const updateIdeFileContent = useCallback((path, content, { dirty = true } = {}) => {
    const target = normalizePath(path)
    setOpenFiles((prev) =>
      prev.map((f) =>
        f.path === target
          ? { ...f, content: content ?? '', dirty: Boolean(dirty) }
          : f,
      ),
    )
  }, [])

  const markDirty = useCallback((path, dirty = true) => {
    const target = normalizePath(path)
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === target ? { ...f, dirty: Boolean(dirty) } : f)),
    )
  }, [])

  const setPendingDiff = useCallback((diff) => {
    if (!diff) {
      setPendingDiffState(null)
      return
    }
    setPendingDiffState({
      path: normalizePath(diff.path),
      proposed: diff.proposed ?? '',
      original: diff.original ?? '',
      phase: diff.phase ?? 5,
    })
  }, [])

  const clearPendingDiff = useCallback(() => {
    setPendingDiffState(null)
  }, [])

  const saveLocalArtifact = useCallback(
    async ({ fileName, content, phase, workspaceId = activeWorkspaceId }) => {
      if (!workspaceId) {
        throw new Error('Select a workspace first')
      }
      return saveArtifactToLocalPc({ workspaceId, fileName, content, phase })
    },
    [activeWorkspaceId],
  )

  const value = useMemo(
    () => ({
      openFiles,
      activeFilePath,
      pendingDiff,
      openIdeFile,
      closeIdeFile,
      setActiveFile,
      updateIdeFileContent,
      markDirty,
      setPendingDiff,
      clearPendingDiff,
      languageFromPath,
      saveLocalArtifact,
    }),
    [
      openFiles,
      activeFilePath,
      pendingDiff,
      openIdeFile,
      closeIdeFile,
      setActiveFile,
      updateIdeFileContent,
      markDirty,
      setPendingDiff,
      clearPendingDiff,
      saveLocalArtifact,
    ],
  )

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
}

export function useEditor() {
  const ctx = useContext(EditorContext)
  if (!ctx) {
    throw new Error('useEditor must be used within EditorProvider')
  }
  return ctx
}
