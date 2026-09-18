# `ROADMAP.md` — AI-Agent Implementation Plan

> **Instructions for the AI Agent:** Execute these tasks sequentially. Do not move to the next task until the current task is completed, verified, and tested locally. Create and modify only the explicitly requested files for each task.

## Phase 1: Local Foundation & Skeleton Setup

### Task 1.1: Project Directory Structure & Backend Init

- **Goal:** Create the local directory structure and initialize a FastAPI virtual environment.
- **Action:**
  1. Create project directories:
     ```
     fuzyo-app/
     ├── backend/
     │   ├── app/
     │   │   ├── api/
     │   │   ├── core/
     │   │   ├── models/
     │   │   ├── services/
     │   │   └── prompts/
     │   └── requirements.txt
     └── frontend/

     ```
  2. Create `backend/requirements.txt` with dependencies: `fastapi`, `uvicorn`, `pydantic`, `pydantic-settings`, `httpx`, `supabase`, `python-dotenv`, `flashrank`, `pypdf`, `python-docx`, `openpyxl`.
  3. Create `backend/app/main.py` with a basic health check endpoint (`GET /health`).
- **Verification:** Run `uvicorn app.main:app --reload` inside `backend/` and verify `GET /health` returns `{"status": "ok"}`.

### Task 1.2: Frontend React Shell (Vite + Tailwind)

- **Goal:** Initialize the React Vite frontend app locally.
- **Action:**
  1. Run `npm create vite@latest frontend -- --template react` inside `fuzyo-app/`.
  2. Install Tailwind CSS and Lucide React icons: `npm install -D tailwindcss postcss autoprefixer`, `npm install lucide-react`.
  3. Configure `tailwind.config.js` and set up `src/index.css` with basic dark-mode styles.
- **Verification:** Run `npm run dev` in `frontend/` and verify the Vite welcome screen loads without styling errors.

## Phase 2: Configuration & Data Schemas

### Task 2.1: Environment Configuration & Pydantic Settings

- **Goal:** Manage environment variables locally for all free cloud providers and local stubs.
- **Files:** `backend/app/core/config.py`, `backend/.env.example`
- **Action:**
  1. Build `config.py` using `pydantic-settings` to load:
     - API Keys: `GROQ_API_KEY`, `GEMINI_API_KEY`, `CEREBRAS_API_KEY`, `SAMBANOVA_API_KEY`, `MISTRAL_API_KEY`, `COHERE_API_KEY`, `OPENROUTER_API_KEY`.
     - Supabase Credentials: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
     - Feature Flags: `FORCE_LOCAL_MOCK` (default `False`).
  2. Create `backend/.env.example` containing placeholder entries for all keys.
- **Verification:** Import `settings` in `app/main.py` and print loaded flags on startup.

### Task 2.2: Core Pydantic Schemas

- **Goal:** Define strict Pydantic schemas for chat requests, router decisions, quality scores, and workspace data.
- **Files:** `backend/app/schemas/chat.py`, `backend/app/schemas/workspace.py`
- **Action:**
  1. Define `ChatRequest`: `prompt`, `sdlc_phase` (enum 1-9), `force_confidential` (bool), `workspace_id` (optional string), `model_override` (optional string).
  2. Define `RouterDecision`: `target_client` (`LOCAL_STUB` vs `CLOUD_API`), `selected_provider`, `selected_model`, `sensitivity_score`, `detected_secrets` (list), `requires_rag` (bool).
  3. Define `QualityScore`: `is_valid` (bool), `tier1_schema_pass` (bool), `tier2_heuristic_pass` (bool), `tier3_score` (int 1-10), `feedback` (string).
  4. Define `Workspace` CRUD schemas: `WorkspaceCreate`, `WorkspaceUpdate`, `WorkspaceOut`.
- **Verification:** Write a short unit test or script instantiating these models with mock data to ensure validation passes.

## Phase 3: Prompt Library & System Instructions

### Task 3.1: System Prompt Repository

- **Goal:** Centralize prompt templates for all 9 SDLC phases, sensitivity detection, and gatekeeper evaluation.
- **Files:** `backend/app/prompts/sdlc_prompts.py`, `backend/app/prompts/eval_prompts.py`
- **Action:**
  1. In `sdlc_prompts.py`, create a dictionary mapping all 9 phases to tailored system instructions (e.g., forcing Markdown tables for QA, Mermaid.js for Architecture, clean code blocks for Développement).
  2. In `eval_prompts.py`, write system prompts for:
     - **Classifier:** Prompt evaluating if a input text contains secrets, credentials, or proprietary business logic.
     - **LLM-as-a-Judge:** Prompt rating an AI response (1–10) based on completeness and SDLC accuracy.
- **Verification:** Import prompts into a test script and assert all 9 SDLC keys exist and return non-empty strings.

## Phase 4: LLM Clients & Privacy Dispatcher Engine

### Task 4.1: Unified Provider Abstraction & Local Stub

- **Goal:** Build a unified client interface to handle requests across cloud providers and local mocks.
- **Files:** `backend/app/services/llm_base.py`, `backend/app/services/local_stub.py`, `backend/app/services/cloud_providers.py`
- **Action:**
  1. Create `BaseLLMClient` abstract class in `llm_base.py` with `async def generate_stream(...)`.
  2. Implement `MockLocalLLMClient` in `local_stub.py` that simulates streaming response tokens locally without external network calls.
  3. Implement provider wrapper classes in `cloud_providers.py` for Groq, Gemini, Cerebras, SambaNova, and Mistral using `httpx.AsyncClient`.
- **Verification:** Run a test script executing `MockLocalLLMClient.generate_stream()` and verify tokens stream to console.

### Task 4.2: Privacy Router & Sensitivity Engine

- **Goal:** Build the brain that routes prompts to Local Stub vs Cloud based on manual toggles and automated sensitivity scores.
- **Files:** `backend/app/services/privacy_router.py`
- **Action:**
  1. Implement regex scanners for API keys (`sk-`, `ghp_`), IP addresses, passwords, and private SSH keys.
  2. Implement `async def route_prompt(request: ChatRequest)`:
     - If `request.force_confidential == True` $\rightarrow$ Return `RouterDecision(target_client="LOCAL_STUB")`.
     - Run regex scanner. If secrets found $\rightarrow$ Return `RouterDecision(target_client="LOCAL_STUB")`.
     - Call Cerebras API (<150ms) to evaluate sensitivity score. If score > 0.7 $\rightarrow$ Route Local.
     - Else $\rightarrow$ Select default Cloud API based on `request.sdlc_phase`.
- **Verification:** Test `route_prompt()` with a prompt containing a fake API key (`sk-12345`) and verify it routes to `LOCAL_STUB`.

## Phase 5: Quality Control Gatekeeper

### Task 5.1: 3-Tier Quality Evaluator

- **Goal:** Build the progressive validation pipeline to verify outputs before streaming to the user.
- **Files:** `backend/app/services/gatekeeper.py`
- **Action:**
  1. **Tier 1 (Schema Check):** Verify Markdown syntax, code block formatting, or JSON schema match expectations.
  2. **Tier 2 (Heuristic Check):** Regex scan generated code for truncated lines, empty function bodies, or placeholders like `TODO: implement`.
  3. **Tier 3 (LLM Judge):** If Tier 1 or Tier 2 fails, execute a Groq API call using `eval_prompts.py` to get a 1-10 quality score. If score < 7, append feedback and trigger a retry prompt.
- **Verification:** Run a test passing a response with `"TODO: add code"` through Tier 2 and confirm `tier2_heuristic_pass` returns `False`.

## Phase 6: Auxiliary RAG & Supabase Setup

### Task 6.1: Supabase Database Migration

- **Goal:** Set up Supabase locally or on the free remote tier using the DAT schema.
- **Files:** `backend/migrations/01_init_schema.sql`
- **Action:**
  1. Save the SQL schema from `DAT.md` into `01_init_schema.sql` (enabling `pgvector`, creating `workspaces`, `document_chunks`, HNSW index, and `hybrid_search_rrf` function).
  2. Apply the migration using the Supabase SQL Editor.
- **Verification:** Run `SELECT * FROM hybrid_search_rrf('test', '[0.0,...]', 5);` in Supabase SQL editor to ensure no syntax errors.

### Task 6.2: Document Loaders & Hybrid Vector Search Service

- **Goal:** Handle file ingestion and execute Reciprocal Rank Fusion (RRF) search.
- **Files:** `backend/app/services/ingestion.py`, `backend/app/services/rag_service.py`
- **Action:**
  1. Implement `BaseDocumentLoader` in `ingestion.py` supporting `.pdf`, `.docx`, `.xlsx`, and `.md` files using `pypdf`, `python-docx`, `openpyxl`.
  2. Implement `rag_service.py` to generate embeddings via Cohere API and invoke the `hybrid_search_rrf` RPC call on Supabase.
  3. Re-rank top 20 candidate results using `flashrank` in-memory CPU ranker.
- **Verification:** Upload a sample Markdown file through the ingestion function and verify chunks appear in `document_chunks`.

## Phase 7: FastAPI Routes & Real-Time SSE Streaming

### Task 7.1: SSE Chat Completion Endpoint

- **Goal:** Expose the primary async streaming chat endpoint with real-time SSE metadata.
- **Files:** `backend/app/api/chat.py`, `backend/app/main.py`
- **Action:**
  1. Implement `POST /api/v1/chat/completions` using FastAPI's `StreamingResponse(media_type="text/event-stream")`.
  2. Pipeline steps inside endpoint:
     - Event 1: Stream routing decision metadata `data: {"type": "routing", ...}`.
     - Event 2: Stream optional RAG retrieval status `data: {"type": "rag", ...}`.
     - Event 3: Stream tokens from selected provider `data: {"type": "token", "content": "..."}`.
     - Event 4: Stream Quality Gatekeeper score `data: {"type": "quality", ...}`.
  3. Include error handling for provider 429 rate limits, falling back dynamically to `OpenRouter API`.
- **Verification:** Test endpoint via `curl -N -X POST http://localhost:8000/api/v1/chat/completions ...` and verify SSE event sequence.

### Task 7.2: Workspace & Analytics Endpoints

- **Goal:** Implement CRUD endpoints for project workspaces and project analytics calculations.
- **Files:** `backend/app/api/workspaces.py`
- **Action:**
  1. Implement `POST /api/v1/workspaces` (Create project).
  2. Implement `GET /api/v1/workspaces` (List projects).
  3. Implement `PUT /api/v1/workspaces/{id}` (Update configuration).
  4. Implement `DELETE /api/v1/workspaces/{id}` (Delete project and purge vector embeddings).
  5. Implement `GET /api/v1/workspaces/{id}/analytics` (Calculate phase completion %, tech stack detection, testability scores).
- **Verification:** Perform full CRUD operations on workspaces using FastAPI Swagger UI (`/docs`).

## Phase 8: React Frontend Implementation

### Task 8.1: State Management & Layout Shell

- **Goal:** Build the main application UI with sidebar navigation, active workspace state, and theme controls.
- **Files:** `frontend/src/context/AppContext.jsx`, `frontend/src/components/Sidebar.jsx`, `frontend/src/components/Header.jsx`
- **Action:**
  1. Build `AppContext` to store active project workspace, selected SDLC phase (1-9), and "Force Confidential" toggle state.
  2. Build `Sidebar.jsx` showing the Workspace Switcher, 9 SDLC Phase navigation buttons, and Agentic Skill triggers (`/plan`, `/analyze`, `/review`, `/debug`).
  3. Build `Header.jsx` displaying the active SDLC phase badge and the Privacy Mode Toggle.

### Task 8.2: Interactive Chat Interface & SSE Listener

- **Goal:** Implement real-time streaming chat with message history, metadata inspector, and artifacts drawer.
- **Files:** `frontend/src/components/ChatContainer.jsx`, `frontend/src/components/MessageItem.jsx`, `frontend/src/components/InspectorDrawer.jsx`
- **Action:**
  1. Build `ChatContainer.jsx` using `fetch` + `ReadableStream` to parse incoming SSE events (`routing`, `token`, `quality`).
  2. Implement `MessageItem.jsx` displaying user/assistant messages, privacy status badges (`[LOCAL STUB]` vs `[CLOUD]`), and code block copy/download buttons.
  3. Implement `InspectorDrawer.jsx` showing real-time routing metrics, provider used, latency, token counts, and Quality Gatekeeper scores.

### Task 8.3: Side-by-Side Canvas & Artifact Preview

- **Goal:** Create a split-screen drawer for rendering code, Markdown, and Mermaid.js diagrams.
- **Files:** `frontend/src/components/CanvasDrawer.jsx`, `frontend/src/components/MermaidRenderer.jsx`
- **Action:**
  1. Implement `CanvasDrawer.jsx` that slides in from the right when generated content contains HTML/React code, documents, or diagrams.
  2. Integrate `mermaid` in `MermaidRenderer.jsx` to render architectural diagrams generated during SDLC Phase 3 (Architecture).

### Task 8.4: Project Workspaces & Analytics Dashboard

- **Goal:** Build project creation wizard and the project status dashboard.
- **Files:** `frontend/src/components/WorkspaceModal.jsx`, `frontend/src/components/AnalyticsDashboard.jsx`
- **Action:**
  1. Build `WorkspaceModal.jsx` to create/edit projects, select stack presets, and upload initial documentation files.
  2. Build `AnalyticsDashboard.jsx` rendering progress bars across all 9 SDLC phases, tech stack tags, and quality index scores.

## Phase 9: Local E2E Verification & Audit

### Task 9.1: End-to-End System Testing

- **Goal:** Validate full system flow locally across privacy routing, cloud fallbacks, RAG, and UI updates.
- **Action:**
  1. **Confidentiality Test:** Toggle "Force Confidential Mode" in UI, submit a code prompt, and verify response displays `[LOCAL MOCK EXECUTION]` badge without sending external API traffic.
  2. **Auto-Routing Test:** Paste a fake API key (`sk-test-12345`) in Auto Mode and verify privacy engine routes locally.
  3. **Cloud Execution Test:** Submit an Architecture request, verify Gemini Flash processes the query, and confirm Mermaid.js renders in the Canvas Drawer.
  4. **Workspace Deletion Test:** Delete a workspace and confirm all associated document chunks are purged from Supabase.