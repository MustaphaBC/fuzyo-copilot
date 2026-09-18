/**
 * Repair common LLM Mermaid mistakes so diagrams render more often.
 */
export function sanitizeMermaid(input) {
  let text = String(input || '')
    .replace(/\r\n/g, '\n')
    .trim()

  if (!text) return ''

  text = text.replace(/^```(?:mermaid)?\s*/i, '').replace(/\s*```$/i, '').trim()
  if (/^mermaid\s*\n/i.test(text)) {
    text = text.replace(/^mermaid\s*\n/i, '')
  }
  text = text.replace(/<!--[\s\S]*?-->/g, '')

  const idMap = new Map()
  let subgraphIdx = 0

  function safeId(raw) {
    const id = String(raw || '').trim()
    if (!id) return id
    if (idMap.has(id)) return idMap.get(id)
    let next = id
    if (/^\d/.test(next)) next = `n${next}`
    next = next.replace(/[^\w-]/g, '_')
    if (!next) next = 'node'
    idMap.set(id, next)
    return next
  }

  const lines = text.split('\n').map((line) => {
    const trimmed = line.trim()
    if (!trimmed) return ''

    const sub = trimmed.match(/^subgraph\s+(.+)$/i)
    if (sub) {
      subgraphIdx += 1
      let rest = sub[1].trim()
      // subgraph 1["Title"] or subgraph 1[Title]
      const idBracket = rest.match(/^(\d[\w-]*)(\s*\[.*)$/)
      if (idBracket) {
        return `subgraph s${idBracket[1]}${idBracket[2]}`
      }
      // subgraph 1. Architecture / subgraph 1 Architecture / subgraph My Module
      if (/^\d/.test(rest) || (/\s/.test(rest) && !rest.includes('['))) {
        const title = rest.replace(/^["']|["']$/g, '')
        return `subgraph s${subgraphIdx} ["${title.replace(/"/g, "'")}"]`
      }
      return `subgraph ${rest}`
    }

    // 1[Label] / 2(Label) / 3{Label}
    const node = trimmed.match(/^(\d[\w-]*)([[({].*)$/)
    if (node) {
      return `${safeId(node[1])}${node[2]}`
    }

    // Remap digit-leading ids in edge / class lines: --> 1, & 2, etc.
    return trimmed.replace(/\b(\d[\w-]*)\b/g, (id, _all, offset, full) => {
      // Keep pure numbers in style values like fill:#fff — only remap likely ids
      const before = full.slice(Math.max(0, offset - 3), offset)
      const after = full.slice(offset + id.length, offset + id.length + 2)
      if (/:#/.test(before)) return id
      if (/^\d+$/.test(id) && /^[%px]/.test(after)) return id
      // Remap when used as node reference near arrows or brackets
      if (
        /(--|==|-\.|\||&)/.test(before) ||
        /(--|==|-\.|[[({])/.test(after) ||
        /^(-->|---|-\.-|==>)/.test(full) ||
        full.includes('-->') ||
        full.includes('---') ||
        full.includes('-.->')
      ) {
        return safeId(id)
      }
      return id
    })
  })

  text = lines.join('\n')

  // Remap digit-leading ids, but never rewrite text inside "..." or [...] labels
  for (const [from, to] of idMap.entries()) {
    if (from === to) continue
    text = remapIdOutsideLabels(text, from, to)
  }

  const opens = (text.match(/^\s*subgraph\b/gim) || []).length
  const closes = (text.match(/^\s*end\s*$/gim) || []).length
  if (opens > closes) {
    text += `\n${'end\n'.repeat(opens - closes)}`
  }

  if (
    !/^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph)\b/im.test(
      text,
    )
  ) {
    text = `flowchart TD\n${text}`
  }

  return text.trim()
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function remapIdOutsideLabels(text, from, to) {
  const re = new RegExp(`\\b${escapeRegExp(from)}\\b`, 'g')
  let result = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"') {
      const end = text.indexOf('"', i + 1)
      if (end === -1) {
        result += text.slice(i)
        break
      }
      result += text.slice(i, end + 1)
      i = end + 1
      continue
    }
    if (ch === '[') {
      const end = text.indexOf(']', i + 1)
      if (end === -1) {
        result += text.slice(i)
        break
      }
      result += text.slice(i, end + 1)
      i = end + 1
      continue
    }
    // copy until next quote/bracket or apply remap on the segment
    let j = i
    while (j < text.length && text[j] !== '"' && text[j] !== '[') j += 1
    const segment = text.slice(i, j)
    result += segment.replace(re, to)
    i = j
  }
  return result
}

export async function renderMermaidSafe(mermaidApi, renderId, rawChart, theme) {
  const source = sanitizeMermaid(rawChart)
  if (!source) {
    return { error: 'Empty Mermaid diagram.', source: '' }
  }

  try {
    mermaidApi.initialize({
      startOnLoad: false,
      theme,
      securityLevel: 'loose',
      suppressErrorRendering: true,
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    })
  } catch {
    /* ignore */
  }

  try {
    const { svg } = await mermaidApi.render(renderId, source)
    cleanupMermaidDom(renderId)
    if (!svg || /Syntax error in text|Parse error|mermaid version/i.test(svg)) {
      return { error: 'Invalid Mermaid syntax after sanitize.', source }
    }
    return { svg, source }
  } catch (err) {
    cleanupMermaidDom(renderId)
    return {
      error: err instanceof Error ? err.message : 'Failed to render diagram',
      source,
    }
  }
}

function cleanupMermaidDom(renderId) {
  if (typeof document === 'undefined') return
  for (const sel of [`#${renderId}`, `#d${renderId}`, `[id^="d${renderId}"]`]) {
    document.querySelectorAll(sel).forEach((el) => el.remove())
  }
  // Remove any stray error graphics mermaid may have appended
  document.querySelectorAll('svg[aria-roledescription="error"]').forEach((el) => el.remove())
}
