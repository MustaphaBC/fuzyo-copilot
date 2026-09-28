# Fuzyo Copilot Frontend

React + Vite frontend for the Fuzyo Copilot product UI.

## Prerequisites

- Node.js 20+ (or the local Fuzyo Node runtime used by `start.ps1`)
- Backend API available at `http://127.0.0.1:8000`

## Local development

From repository root:

### Option A (recommended on Windows)

Use the root launcher script, which starts backend + frontend together:

```powershell
.\start.ps1
```

### Option B (manual frontend run)

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

The frontend will be available at `http://127.0.0.1:5173`.

## Environment variables

Create `frontend/.env` for local Vite development:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

For Docker Compose image builds, these frontend variables are read from the repository root `.env` and passed as build args (see `docker-compose.yml`).

`VITE_E2E_AUTH_BYPASS` is reserved for Playwright e2e runs only and must not be enabled for normal UI usage.

## Scripts

- `npm run dev` - start Vite dev server
- `npm run build` - production build
- `npm run preview` - preview built app
- `npm run lint` - run ESLint
- `npm run test:e2e` - Playwright Chromium suite
- `npm run test:e2e:demo` - live demo Playwright scenario
- `npm run test:e2e:ui` - Playwright interactive UI mode
