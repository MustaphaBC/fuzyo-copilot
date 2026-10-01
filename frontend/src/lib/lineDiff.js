export function buildLineDiff(previous, current) {
  const a = (previous || '').split('\n')
  const b = (current || '').split('\n')
  const max = Math.max(a.length, b.length)
  const rows = []
  for (let i = 0; i < max; i += 1) {
    const left = a[i]
    const right = b[i]
    if (left === right) {
      rows.push({ type: 'same', text: right ?? '' })
    } else {
      if (left !== undefined) rows.push({ type: 'del', text: left })
      if (right !== undefined) rows.push({ type: 'add', text: right })
    }
  }
  return rows
}
