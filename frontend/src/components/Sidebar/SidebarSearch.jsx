import { useEffect, useState } from 'react'

export default function SidebarSearch({ value, onChange, placeholder = 'Search chats…' }) {
  const [local, setLocal] = useState(value || '')

  useEffect(() => {
    setLocal(value || '')
  }, [value])

  useEffect(() => {
    const id = window.setTimeout(() => onChange?.(local), 150)
    return () => window.clearTimeout(id)
  }, [local, onChange])

  return (
    <input
      type="search"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      placeholder={placeholder}
      data-testid="sidebar-search"
      className="w-full rounded-lg border border-[var(--border)] bg-[var(--chip)] px-2.5 py-1.5 text-sm text-[var(--app-fg)] outline-none placeholder:text-[var(--muted)] focus:ring-1 focus:ring-[var(--muted)]"
      aria-label="Search chats"
    />
  )
}
