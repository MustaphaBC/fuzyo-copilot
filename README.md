# Fuzyo Copilot

Fuzyo Copilot is a full-stack SDLC assistant with:
- **Frontend:** React + Vite + Tailwind
- **Backend:** FastAPI + SSE streaming
- **Data/Auth:** Supabase

It supports workspace-based project assistance, chat completions, analytics, artifacts, and IDE-style file operations.

## Project structure

```text
.
├── backend/        # FastAPI API, services, tests, migrations
├── frontend/       # React app, UI, Playwright e2e tests
├── docs/           # Product and architecture documentation
├── docker-compose.yml
└── start.ps1       # Windows launcher for backend + frontend
```

## Requirements

- Python 3.12+
- Node.js 22+
- npm
- (Optional) Docker + Docker Compose

## Environment variables

### Backend (`backend/.env`)

Copy `backend/.env.example` to `backend/.env` and fill at least:
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_JWT_SECRET`

Optional provider keys:
- `GROQ_API_KEY`
- `GEMINI_API_KEY`
- `CEREBRAS_API_KEY`
- `SAMBANOVA_API_KEY`
- `MISTRAL_API_KEY`
- `COHERE_API_KEY`
- `OPENROUTER_API_KEY`

### Frontend (`frontend/.env` for local Vite dev)

Create `frontend/.env` with:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

### Docker Compose build-time frontend vars (root `.env`)

When using Docker Compose, set in root `.env`:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Run with Docker (full stack)

From repository root:

```bash
docker compose up --build
```

Open: `http://localhost:8080`

## Run locally (without Docker)

### Backend

From repository root:

```bash
python -m pip install --upgrade pip
pip install -r backend/requirements.txt
PYTHONPATH=. uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

Health check: `http://127.0.0.1:8000/health`

### Frontend

```bash
cd frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

App: `http://127.0.0.1:5173`

### Windows shortcut

You can also run:

```powershell
.\start.ps1
```

## Useful commands

### Backend tests

```bash
pytest backend/tests -q --cov=backend/app --cov-report=term-missing --cov-fail-under=0
```

### Frontend lint + build

```bash
cd frontend
npm run lint
npm run build
```

### Frontend e2e (Chromium)

```bash
cd frontend
npx playwright install --with-deps chromium
npx playwright test --project=chromium
```

## Main API routes

Base prefix: `/api/v1`

- `POST /chat/completions`
- `GET /models/available`
- `POST /workspaces`
- `POST /workspaces/create-and-ingest`
- `GET /workspaces`
- `PUT /workspaces/{workspace_id}`
- `DELETE /workspaces/{workspace_id}`
- `GET /workspaces/{workspace_id}/analytics`
- `GET /workspaces/{workspace_id}/fs/tree`
- `GET /workspaces/{workspace_id}/fs/file`
- `PUT /workspaces/{workspace_id}/fs/file`
- `POST /uat/sign-off`

## Documentation

See `/docs` for project materials:
- `SFD.md`
- `DAT.md`
- `CDC.md`
- `Rapport_Fuzyo_Copilot_SDLC.md`
