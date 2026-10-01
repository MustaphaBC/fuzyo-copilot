export const SDLC_PHASES = [
  { id: 1, label: 'Expression du besoin' },
  { id: 2, label: 'Analyse fonctionnelle' },
  { id: 3, label: 'Architecture' },
  { id: 4, label: 'Gestion de projet / PO' },
  { id: 5, label: 'Développement' },
  { id: 6, label: 'Tests & QA' },
  { id: 7, label: 'Recette' },
  { id: 8, label: 'DevOps / CI-CD' },
  { id: 9, label: 'Mise en production' },
]

export const DEFAULT_AI_BEHAVIOR = {
  useProjectContext: true,
  preferProjectFiles: true,
  useWorkspaceKnowledge: true,
}

export function parseSelectedModelKey(selectedModelKey) {
  if (!selectedModelKey || selectedModelKey === 'auto') {
    return { provider: null, model: null }
  }
  const colon = selectedModelKey.indexOf(':')
  if (colon <= 0) {
    return { provider: null, model: selectedModelKey }
  }
  return {
    provider: selectedModelKey.slice(0, colon),
    model: selectedModelKey.slice(colon + 1),
  }
}
