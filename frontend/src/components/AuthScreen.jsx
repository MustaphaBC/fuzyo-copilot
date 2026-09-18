import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

const ROLE_OPTIONS = [
  { value: 'developer', label: 'Developer' },
  { value: 'tech_lead', label: 'Tech Lead' },
  { value: 'product_owner', label: 'Product Owner' },
  { value: 'admin', label: 'Admin' },
]

export default function AuthScreen() {
  const { signIn, signUp, configured } = useAuth()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('developer')
  const [organization, setOrganization] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState('')

  async function onSubmit(event) {
    event.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error: err } = await signIn(email.trim(), password)
        if (err) setError(err.message || 'Sign in failed')
      } else {
        const { data, error: err } = await signUp(email.trim(), password, {
          fullName: fullName.trim(),
          role,
          organization: organization.trim(),
        })
        if (err) {
          setError(err.message || 'Sign up failed')
        } else if (data?.user && !data?.session) {
          setInfo('Check your email to confirm your account, then sign in.')
          setMode('signin')
        }
      }
    } catch (err) {
      setError(err?.message || 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] px-4 text-[var(--app-fg)]">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--app-fg)]">Fuzyo</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {mode === 'signin' ? 'Sign in to continue' : 'Create your account'}
          </p>
        </div>

        {!configured && (
          <p className="mb-4 rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
            Set <code className="text-xs">VITE_SUPABASE_URL</code> and{' '}
            <code className="text-xs">VITE_SUPABASE_ANON_KEY</code> in the frontend env.
          </p>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          {mode === 'signup' && (
            <>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  Full Name
                </span>
                <input
                  type="text"
                  autoComplete="name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2.5 text-sm text-[var(--app-fg)] outline-none ring-[var(--accent)] focus:ring-1"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  Role
                </span>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2.5 text-sm text-[var(--app-fg)] outline-none ring-[var(--accent)] focus:ring-1"
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  Organization
                </span>
                <input
                  type="text"
                  autoComplete="organization"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2.5 text-sm text-[var(--app-fg)] outline-none ring-[var(--accent)] focus:ring-1"
                />
              </label>
            </>
          )}

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
              Email
            </span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2.5 text-sm text-[var(--app-fg)] outline-none ring-[var(--accent)] focus:ring-1"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
              Password
            </span>
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2.5 text-sm text-[var(--app-fg)] outline-none ring-[var(--accent)] focus:ring-1"
            />
          </label>

          {error && (
            <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}
          {info && (
            <p className="rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">
              {info}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !configured}
            className="w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-fg)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--muted)]">
          {mode === 'signin' ? (
            <>
              No account?{' '}
              <button
                type="button"
                className="text-[var(--accent)] hover:underline"
                onClick={() => {
                  setMode('signup')
                  setError('')
                  setInfo('')
                }}
              >
                Create account
              </button>
            </>
          ) : (
            <>
              Already registered?{' '}
              <button
                type="button"
                className="text-[var(--accent)] hover:underline"
                onClick={() => {
                  setMode('signin')
                  setError('')
                  setInfo('')
                }}
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
