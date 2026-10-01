import { Activity, KeyRound, RefreshCw, ScrollText, ShieldAlert, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { NavLink, Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { apiFetch } from '../../lib/api'
import { isAdminUser } from '../../lib/roles'
import EmptyState from '../UI/EmptyState'
import ErrorState from '../UI/ErrorState'

const SECTIONS = [
  { id: 'users', label: 'Users', icon: Users },
  { id: 'audit', label: 'Audit log', icon: ScrollText },
  { id: 'providers', label: 'AI providers', icon: KeyRound },
  { id: 'metrics', label: 'Observability', icon: Activity },
]

function useAdminResource(path) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch(path)
      if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`)
      setData(await response.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    void load()
  }, [load])

  return { data, loading, error, reload: load }
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function Table({ columns, rows, empty, testId }) {
  if (!rows.length) return <p className="py-6 text-sm text-[var(--muted)]">{empty}</p>
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)]" data-testid={testId}>
      <table className="w-full text-left text-sm">
        <thead className="bg-[var(--panel-elevated)] text-xs uppercase tracking-wide text-[var(--muted)]">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="whitespace-nowrap px-3 py-2 font-medium">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? index} className="border-t border-[var(--border)]">
              {columns.map((column) => (
                <td key={column.key} className="max-w-xs truncate px-3 py-2 text-[var(--app-fg)]">
                  {column.render ? column.render(row) : (row[column.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SectionHeader({ title, description, onRefresh, loading, children }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-medium text-[var(--app-fg)]">{title}</h2>
        {description ? <p className="mt-1 text-sm text-[var(--muted)]">{description}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        {children}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label={`Refresh ${title}`}
          className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  )
}

function UsersSection() {
  const { data, loading, error, reload } = useAdminResource('/api/v1/admin/users')
  return (
    <div className="space-y-4" data-testid="admin-users">
      <SectionHeader
        title="Users"
        description="Profiles synced from Supabase Auth. Platform admin is granted via app_metadata.role."
        onRefresh={reload}
        loading={loading}
      />
      {error ? <ErrorState title="Users unavailable" description={error} onRetry={reload} /> : null}
      {data ? (
        <Table
          testId="admin-users-table"
          empty="No profiles found."
          rows={data.users}
          columns={[
            { key: 'email', label: 'Email', render: (row) => row.email || row.id },
            { key: 'full_name', label: 'Name' },
            { key: 'profile_role', label: 'Profile role' },
            {
              key: 'platform_role',
              label: 'Platform role',
              render: (row) => (row.platform_role === 'admin' ? 'admin' : '—'),
            },
            { key: 'organization', label: 'Organization' },
            { key: 'last_sign_in_at', label: 'Last sign-in', render: (row) => formatDate(row.last_sign_in_at) },
          ]}
        />
      ) : null}
    </div>
  )
}

function AuditSection() {
  const [action, setAction] = useState('')
  const query = new URLSearchParams({ limit: '300', ...(action ? { action } : {}) })
  const { data, loading, error, reload } = useAdminResource(`/api/v1/admin/audit?${query}`)
  return (
    <div className="space-y-4" data-testid="admin-audit">
      <SectionHeader
        title="Audit log"
        description="Append-only record of workspace and host filesystem mutations."
        onRefresh={reload}
        loading={loading}
      >
        <select
          value={action}
          onChange={(event) => setAction(event.target.value)}
          aria-label="Filter by action"
          className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--app-fg)]"
        >
          <option value="">All actions</option>
          {[
            'fs.write',
            'fs.apply_changes',
            'fs.save_artifact',
            'fs.upload_document',
            'fs.create_and_ingest',
            'knowledge.delete',
            'workspace.create',
            'workspace.update',
            'workspace.delete',
          ].map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </SectionHeader>
      {error ? <ErrorState title="Audit log unavailable" description={error} onRetry={reload} /> : null}
      {data && !data.log_available ? (
        <EmptyState title="No audit log yet" description="Entries appear after the first workspace mutation." />
      ) : null}
      {data?.log_available ? (
        <Table
          testId="admin-audit-table"
          empty="No entries match this filter."
          rows={data.entries}
          columns={[
            { key: 'timestamp', label: 'Time', render: (row) => formatDate(row.timestamp) },
            { key: 'action', label: 'Action' },
            { key: 'file_path', label: 'Target' },
            { key: 'user_id', label: 'User' },
            { key: 'client_ip', label: 'IP' },
          ]}
        />
      ) : null}
    </div>
  )
}

const PROVIDER_STATUS_CLASSES = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-red-600 dark:text-red-400',
  unchecked: 'text-[var(--muted)]',
  not_configured: 'text-amber-600 dark:text-amber-400',
}

function ProvidersSection() {
  const [ping, setPing] = useState(false)
  const { data, loading, error, reload } = useAdminResource(`/api/v1/admin/providers?ping=${ping}`)
  return (
    <div className="space-y-4" data-testid="admin-providers">
      <SectionHeader
        title="AI providers"
        description="Key presence per provider (values are never returned). Ping sends only an authenticated model-list request."
        onRefresh={reload}
        loading={loading}
      >
        <button
          type="button"
          onClick={() => setPing(true)}
          disabled={loading}
          className="rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-1.5 text-sm text-[var(--app-fg)] hover:bg-[var(--hover)] disabled:opacity-50"
          data-testid="admin-providers-ping"
        >
          Ping providers
        </button>
      </SectionHeader>
      {error ? <ErrorState title="Providers unavailable" description={error} onRetry={reload} /> : null}
      {data?.force_local_mock ? (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-200">
          FORCE_LOCAL_MOCK is enabled — every request is routed to the local model.
        </p>
      ) : null}
      {data ? (
        <Table
          testId="admin-providers-table"
          empty="No providers."
          rows={data.providers.map((item) => ({ ...item, id: item.provider }))}
          columns={[
            { key: 'provider', label: 'Provider' },
            { key: 'purpose', label: 'Purpose' },
            { key: 'default_model', label: 'Default model' },
            {
              key: 'status',
              label: 'Status',
              render: (row) => (
                <span className={PROVIDER_STATUS_CLASSES[row.status] || ''}>
                  {row.status.replace('_', ' ')}
                  {row.detail ? ` (${row.detail})` : ''}
                </span>
              ),
            },
            {
              key: 'latency_ms',
              label: 'Latency',
              render: (row) => (typeof row.latency_ms === 'number' ? `${row.latency_ms} ms` : '—'),
            },
          ]}
        />
      ) : null}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-elevated)] px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[var(--app-fg)]">{value}</p>
    </div>
  )
}

function pct(value) {
  return typeof value === 'number' ? `${value.toFixed(1)}%` : '—'
}

function MetricsSection() {
  const { data, loading, error, reload } = useAdminResource('/api/v1/admin/metrics')
  const bucketColumns = [
    { key: 'key', label: 'Key' },
    { key: 'requests', label: 'Requests' },
    { key: 'total_tokens', label: 'Tokens (est.)' },
    { key: 'estimated_cost_usd', label: 'Cost (est. USD)', render: (row) => row.estimated_cost_usd.toFixed(4) },
  ]
  return (
    <div className="space-y-4" data-testid="admin-metrics">
      <SectionHeader
        title="Observability"
        description="Aggregated from persisted usage records (token counts are estimates; prompt text is never stored)."
        onRefresh={reload}
        loading={loading}
      />
      {error ? <ErrorState title="Metrics unavailable" description={error} onRetry={reload} /> : null}
      {data && data.requests === 0 ? (
        <EmptyState title="No usage recorded yet" description="Metrics appear after the first chat completion." />
      ) : null}
      {data && data.requests > 0 ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Requests" value={data.requests} />
            <Stat label="Tokens (est.)" value={data.total_tokens.toLocaleString()} />
            <Stat label="Cost (est.)" value={`$${data.estimated_cost_usd.toFixed(4)}`} />
            <Stat
              label="Latency avg / p95"
              value={`${data.avg_latency_ms ?? '—'} / ${data.p95_latency_ms ?? '—'} ms`}
            />
            <Stat label="Local routing" value={pct(data.local_share_pct)} />
            <Stat label="Quality pass rate" value={pct(data.quality_pass_rate_pct)} />
            <Stat label="Retry rate" value={pct(data.retry_rate_pct)} />
            <Stat
              label="Route reasons"
              value={Object.keys(data.route_reasons).length || '—'}
            />
          </div>
          {Object.keys(data.route_reasons).length ? (
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(data.route_reasons).map(([reason, count]) => (
                <span key={reason} className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[var(--muted)]">
                  {reason}: {count}
                </span>
              ))}
            </div>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <h3 className="text-xs uppercase tracking-wide text-[var(--muted)]">By provider</h3>
              <Table rows={data.by_provider.map((b) => ({ ...b, id: b.key }))} columns={bucketColumns} empty="—" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xs uppercase tracking-wide text-[var(--muted)]">By SDLC phase</h3>
              <Table rows={data.by_phase.map((b) => ({ ...b, id: b.key }))} columns={bucketColumns} empty="—" />
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-[var(--muted)]">Recent requests</h3>
            <Table
              rows={data.recent}
              empty="—"
              columns={[
                { key: 'timestamp', label: 'Time', render: (row) => formatDate(row.timestamp) },
                { key: 'provider', label: 'Provider' },
                { key: 'target_client', label: 'Target' },
                { key: 'sdlc_phase', label: 'Phase' },
                { key: 'latency_ms', label: 'Latency', render: (row) => (row.latency_ms != null ? `${row.latency_ms} ms` : '—') },
                { key: 'quality_score', label: 'Score' },
                { key: 'attempts', label: 'Attempts' },
              ]}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}

function SectionBody({ section }) {
  switch (section) {
    case 'users':
      return <UsersSection />
    case 'audit':
      return <AuditSection />
    case 'providers':
      return <ProvidersSection />
    case 'metrics':
      return <MetricsSection />
    default: {
      const exhaustive = section
      throw new Error(`Unknown admin section: ${exhaustive}`)
    }
  }
}

export default function AdminPage() {
  const { section } = useParams()
  const { user } = useAuth()

  if (!isAdminUser(user)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6" data-testid="admin-forbidden">
        <ShieldAlert className="h-8 w-8 text-[var(--muted)]" aria-hidden="true" />
        <EmptyState
          title="Admin access required"
          description="Ask a platform administrator to set app_metadata.role = 'admin' on your Supabase account."
        />
      </div>
    )
  }

  if (!SECTIONS.some((item) => item.id === section)) {
    return <Navigate to="/admin/users" replace />
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row" data-testid="admin-page">
      <nav
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--panel)] p-2 md:w-52 md:flex-col md:border-b-0 md:border-r"
        aria-label="Admin sections"
      >
        {SECTIONS.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.id}
              to={`/admin/${item.id}`}
              data-testid={`admin-nav-${item.id}`}
              className={({ isActive }) =>
                `inline-flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm transition ${
                  isActive
                    ? 'bg-[var(--panel-elevated)] text-[var(--app-fg)]'
                    : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]'
                }`
              }
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {item.label}
            </NavLink>
          )
        })}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <SectionBody section={section} />
      </div>
    </div>
  )
}
