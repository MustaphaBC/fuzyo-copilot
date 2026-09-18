# Dossier d’Architecture Technique (DAT) — Fuzyo

## 1. Vue d’Ensemble de l’Architecture

La plateforme repose sur une architecture **Frontend / Backend asynchrone**, avec une communication temps réel basée sur **Server-Sent Events (SSE)** pour le streaming des réponses et des événements générés par le backend.

```text
┌──────────────────────────────────────────────────────────────┐
│                       FRONTEND LAYER                         │
│                                                              │
│ React + Vite + Tailwind CSS + Lucide Icons + Mermaid.js      │
│ EventSource / SSE                                            │
└──────────────────────────────┬───────────────────────────────┘
                               │
                         HTTP / SSE
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                       BACKEND LAYER                          │
│                                                              │
│ Python 3.11+                                                 │
│ FastAPI + Pydantic v2 + HTTPX                                │
│ Async / Streaming / API Orchestration                        │
└───────────────┬──────────────────────────────┬───────────────┘
                │                              │
                ▼                              ▼
┌───────────────────────────────┐   ┌─────────────────────────┐
│       DATA & RAG LAYER        │   │      LLM ECOSYSTEM      │
│                               │   │                         │
│ PostgreSQL                    │   │ Cerebras                │
│ + pgvector                    │   │ Groq                    │
│ + pg_trgm                     │   │ SambaNova               │
│                               │   │ Gemini                  │
│ Supabase                      │   │ Mistral                 │
│                               │   │ Cohere                  │
│ Hybrid Search                 │   │ OpenRouter              │
│ Vector + Full-Text Search    │   │ Local Mock LLM           │
└───────────────────────────────┘   └─────────────────────────┘
```

### Principes architecturaux

L’architecture suit plusieurs principes :

- **Séparation Frontend / Backend** afin d’isoler l’interface utilisateur de la logique métier.
- **Architecture asynchrone** basée sur FastAPI et Python `async/await`.
- **Streaming temps réel** avec Server-Sent Events (SSE).
- **Architecture RAG hybride** combinant recherche vectorielle et recherche textuelle.
- **Routage multi-LLM** permettant de sélectionner dynamiquement le fournisseur adapté à la tâche.
- **Fallback automatique** vers d’autres fournisseurs en cas d’indisponibilité ou de limitation de débit.
- **Isolation par workspace** pour garantir la séparation logique des données des différents projets.

---

# 2. Stack Technique

## 2.1 Frontend

| Technologie | Rôle |
|---|---|
| React | Framework de l’interface utilisateur |
| Vite | Build tool et environnement de développement |
| Tailwind CSS | Système de styling |
| Lucide Icons | Bibliothèque d’icônes |
| Mermaid.js | Génération et rendu des diagrammes |
| EventSource / SSE | Réception des événements temps réel |

Le frontend communique avec le backend via des API REST et un canal SSE dédié au streaming des réponses.

---

## 2.2 Backend

| Technologie | Rôle |
|---|---|
| Python 3.11+ | Langage principal |
| FastAPI | Framework API asynchrone |
| Pydantic v2 | Validation et sérialisation des données |
| HTTPX | Communication HTTP asynchrone avec les fournisseurs externes |
| FlashRank | Reranking local basé CPU |

FastAPI constitue la couche d’orchestration principale entre le frontend, la base de données, le pipeline RAG et les différents fournisseurs LLM.

---

## 2.3 Stockage et recherche

La couche de données repose sur :

- **PostgreSQL** comme SGBD principal.
- **pgvector** pour la recherche par similarité vectorielle.
- **pg_trgm** pour la recherche textuelle et la similarité lexicale.
- **Supabase** comme infrastructure PostgreSQL managée.

L’architecture RAG utilise une stratégie de **Hybrid Search**, combinant :

```text
                User Query
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
   Vector Search          Full-Text Search
     pgvector                 PostgreSQL
          │                   │
          └─────────┬─────────┘
                    ▼
          Reciprocal Rank Fusion
                    │
                    ▼
               Reranking
                    │
                    ▼
             Context Builder
                    │
                    ▼
                 LLM
```

---

# 3. Écosystème LLM et stratégie de routage

La plateforme est conçue pour fonctionner avec plusieurs fournisseurs de modèles afin d’éviter une dépendance à un fournisseur unique.

| Fournisseur | Usage prévu |
|---|---|
| Cerebras | Routage et tâches nécessitant une très faible latence |
| Groq | Inférence LLM à faible latence |
| SambaNova | Tâches de génération et de raisonnement |
| Google Gemini | Tâches nécessitant une grande fenêtre de contexte |
| Mistral AI | Génération et assistance au développement logiciel |
| Cohere | Embeddings et/ou reranking selon les modèles sélectionnés |
| OpenRouter | Couche de fallback et accès multi-modèles |
| MockLocalLLMClient | Développement et tests locaux sans dépendance externe |

### Routage logique

```text
                    User Request
                         │
                         ▼
                 Request Classifier
                         │
                         ▼
                  Model Router
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
      Fast Task      Coding Task    Complex Task
          │              │              │
          ▼              ▼              ▼
      Groq /         Mistral /      Gemini /
      Cerebras       Groq           SambaNova
                         │
                         ▼
                   Fallback Layer
                         │
                         ▼
                    OpenRouter
```

Le routage doit être **configurable** et ne doit pas dépendre de valeurs codées en dur.

---

# 4. Architecture RAG

Le pipeline RAG suit les étapes suivantes :

```text
Documents
    │
    ▼
Document Ingestion
    │
    ▼
Parsing / Extraction
    │
    ▼
Chunking
    │
    ▼
Metadata Enrichment
    │
    ▼
Embedding Generation
    │
    ▼
PostgreSQL + pgvector
    │
    │
User Query
    │
    ▼
Query Processing
    │
    ├───────────────┐
    ▼               ▼
Vector Search    Full-Text Search
    │               │
    └───────┬───────┘
            ▼
       RRF Fusion
            │
            ▼
         Reranking
            │
            ▼
      Context Selection
            │
            ▼
       Prompt Builder
            │
            ▼
        LLM Router
            │
            ▼
         Response
            │
            ▼
       SSE Streaming
```

---

# 5. Schéma de Données PostgreSQL / Supabase

> **Important :** la dimension du champ `embedding` doit correspondre exactement au modèle d’embedding réellement utilisé. Elle ne doit donc pas être présentée comme universellement égale à 1536.

Exemple avec un modèle produisant des vecteurs de dimension 1536 :

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    tech_stack JSONB DEFAULT '[]'::jsonb,
    custom_instructions TEXT,
    owner_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    workspace_id UUID NOT NULL
        REFERENCES workspaces(id)
        ON DELETE CASCADE,

    content TEXT NOT NULL,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Exemple : dimension 1536.
    -- À adapter au modèle d'embedding choisi.
    embedding VECTOR(1536),

    fts_tokens TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('french', content)
    ) STORED,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chunks_workspace
ON document_chunks(workspace_id);

CREATE INDEX idx_chunks_embedding
ON document_chunks
USING hnsw (embedding vector_cosine_ops);

CREATE INDEX idx_chunks_fts
ON document_chunks
USING gin (fts_tokens);

-- Chat message bodies (thread rows live in chat_threads).
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL
        REFERENCES workspaces(id)
        ON DELETE CASCADE,
    thread_id UUID NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL DEFAULT '',
    routing_badge TEXT NULL,
    sdlc_phase INT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sort_index INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS chat_messages_thread_idx
ON chat_messages (workspace_id, thread_id, sort_index);

-- Server-side thread list / titles (see migrations/03_chat_threads.sql).
CREATE TABLE IF NOT EXISTS chat_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL
        REFERENCES workspaces(id)
        ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'New chat',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_threads_workspace_updated_idx
ON chat_threads (workspace_id, updated_at DESC);
```

API:
- `GET /api/v1/workspaces/{id}/threads`
- `POST /api/v1/workspaces/{id}/threads`
- `PATCH /api/v1/threads/{thread_id}`
- `DELETE /api/v1/threads/{thread_id}`
- `GET /api/v1/workspaces/{id}/threads/{thread_id}/messages`
- `PUT /api/v1/workspaces/{id}/threads/{thread_id}/messages` (full replace)
- `DELETE /api/v1/workspaces/{id}/threads/{thread_id}/messages`
- Completions accept optional `thread_id` + `history_window` (≤10) for multi-turn memory
- Threads support `is_pinned` (migration `05_thread_pins.sql`) for Pinned / Recent sidebar sections

### Enterprise profiles, RBAC & overview (migration `06`)

Apply in Supabase SQL Editor after `05_thread_pins.sql`:

- File: `backend/migrations/06_enterprise_features.sql`
- Creates/hardens `public.profiles` (`full_name`, `role` NOT NULL default `developer`, `organization`, `updated_at`) synced from `auth.users` metadata via `on_auth_user_created`
- Safe to re-run if `profiles` already exists without `updated_at` / role default
- Adds `workspaces.sdlc_audit_report JSONB` for deterministic project analyzer output
- Roles (lowercase): `developer` | `tech_lead` | `product_owner` | `admin`
- Admin-only chat intents: `deploy_to_production`, `purge_workspace_rag` → SSE `admin_restricted` for non-admins
- Dual-mode create: `POST /api/v1/workspaces/create-and-ingest` (`docs` | `codebase`)
- Analytics includes `sdlc_audit_report` (languages, frameworks, 9 SDLC phases, scores)

### Auth (Supabase JWT)

- `GET /health` is public.
- All `/api/v1/*` routes require `Authorization: Bearer <access_token>` (Supabase Auth email/password session JWT).
- Backend verifies tokens via JWKS from `SUPABASE_URL` (`/auth/v1/.well-known/jwks.json`, RS256/ES256). Legacy `SUPABASE_JWT_SECRET` remains as HS256 fallback (never expose to the frontend).
- Workspace isolation: `workspaces.owner_id` → `auth.users(id)`; threads/messages inherit via workspace ownership checks.
- Migration: `backend/migrations/04_workspace_owner.sql`.

#### Env setup (signup flow)

| Variable | Where | Purpose |
|----------|--------|---------|
| `VITE_SUPABASE_URL` | `frontend/.env` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `frontend/.env` | Public anon key (Auth client only) |
| `SUPABASE_URL` | `backend/.env` | Project URL (DB + JWKS discovery) |
| `SUPABASE_SECRET_KEY` | `backend/.env` | Service role DB access |
| `SUPABASE_JWT_SECRET` | `backend/.env` | Legacy HS256 JWT Secret (fallback) |
| `FUZYO_BEARER` | shell (optional) | Access token for `backend/scripts/e2e_verify.py` |
| `VITE_E2E_AUTH_BYPASS` | Playwright only | Synthetic session; do not enable for normal use |

Enable **Email** provider in Supabase Auth. Apply migrations `04_workspace_owner.sql`, `05_thread_pins.sql`, and `06_enterprise_features.sql`. Sign up in the UI (Full Name / Role / Organization) → session JWT is sent as Bearer on `/api/v1`.

---

# 6. Recherche Hybride avec Reciprocal Rank Fusion

La recherche hybride combine :

1. recherche vectorielle ;
2. recherche full-text ;
3. fusion des résultats avec **Reciprocal Rank Fusion (RRF)**.

La formule utilisée est :

```text
RRF(d) = Σ 1 / (k + rank_i(d))
```

où :

- `d` représente le document ;
- `rank_i(d)` représente son rang dans une méthode de recherche ;
- `k` est une constante permettant de réduire l’influence des premiers rangs.

Exemple d’implémentation PostgreSQL :

```sql
CREATE OR REPLACE FUNCTION hybrid_search_rrf(
    p_workspace_id UUID,
    p_query_text TEXT,
    p_query_embedding VECTOR(1536),
    p_match_count INT DEFAULT 20,
    p_rrf_k INT DEFAULT 60
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    metadata JSONB,
    rrf_score FLOAT
)
LANGUAGE sql
AS $$
WITH vector_ranks AS (
    SELECT
        dc.id,
        ROW_NUMBER() OVER (
            ORDER BY dc.embedding <=> p_query_embedding
        ) AS rank
    FROM document_chunks dc
    WHERE dc.workspace_id = p_workspace_id
      AND dc.embedding IS NOT NULL
    LIMIT p_match_count
),

fts_ranks AS (
    SELECT
        dc.id,
        ROW_NUMBER() OVER (
            ORDER BY ts_rank(
                dc.fts_tokens,
                websearch_to_tsquery('french', p_query_text)
            ) DESC
        ) AS rank
    FROM document_chunks dc
    WHERE dc.workspace_id = p_workspace_id
      AND dc.fts_tokens @@ websearch_to_tsquery(
          'french',
          p_query_text
      )
    LIMIT p_match_count
)

SELECT
    dc.id,
    dc.content,
    dc.metadata,

    COALESCE(
        1.0 / (p_rrf_k + vr.rank),
        0.0
    )
    +
    COALESCE(
        1.0 / (p_rrf_k + fr.rank),
        0.0
    ) AS rrf_score

FROM document_chunks dc

LEFT JOIN vector_ranks vr
    ON dc.id = vr.id

LEFT JOIN fts_ranks fr
    ON dc.id = fr.id

WHERE vr.id IS NOT NULL
   OR fr.id IS NOT NULL

ORDER BY rrf_score DESC

LIMIT p_match_count;
$$;
```

### Corrections importantes par rapport à la version initiale

La fonction prend maintenant en compte le :

```text
workspace_id
```

afin d’éviter qu’une recherche RAG d’un workspace récupère accidentellement des documents appartenant à un autre workspace.

La recherche textuelle utilise également :

```sql
websearch_to_tsquery()
```

qui est plus robuste pour des requêtes utilisateur naturelles que la construction directe d’un `to_tsquery()`.

---

# 7. Interfaces API — FastAPI

## Chat

```http
POST /api/v1/chat/completions
```

Responsabilités :

- réception du message utilisateur ;
- identification du workspace ;
- recherche RAG ;
- sélection du modèle ;
- génération de la réponse ;
- streaming via SSE ;
- transmission des métadonnées de routage.

---

## Workspaces

```http
POST /api/v1/workspaces
```

Création d’un nouveau workspace.

Exemple de données :

```json
{
    "name": "Fuzyo SDLC",
    "description": "AI-powered software development workspace",
    "tech_stack": [
        "React",
        "FastAPI",
        "PostgreSQL"
    ],
    "custom_instructions": "..."
}
```

---

## Analytics

```http
GET /api/v1/workspaces/{id}/analytics
```

Retourne les métriques relatives au workspace, notamment :

- progression SDLC ;
- couverture documentaire ;
- nombre de documents ;
- nombre de chunks ;
- activité du workspace ;
- métriques RAG disponibles.

---

## Document Ingestion

```http
POST /api/v1/documents/ingest
```

Responsabilités :

```text
Upload
   ↓
Parsing
   ↓
Chunking
   ↓
Metadata extraction
   ↓
Embedding generation
   ↓
Vector storage
   ↓
FTS indexing
```

---

# 8. Communication SSE

Le streaming des réponses utilise **Server-Sent Events**.

```text
Frontend
   │
   │ POST /chat/completions
   ▼
FastAPI
   │
   ├── RAG
   ├── Router
   └── LLM
          │
          ▼
      Token/Event
          │
          ▼
      SSE Stream
          │
          ▼
       Browser
```

Exemple conceptuel :

```text
event: metadata
data: {"provider":"groq","model":"..."}

event: token
data: {"content":"Bonjour"}

event: token
data: {"content":" ..."}

event: done
data: {"status":"completed"}
```

Cette approche permet au frontend d’afficher progressivement la réponse sans attendre la fin complète de la génération.

---

# 9. Stratégie de Déploiement

L’objectif est de maintenir une architecture à coût minimal en utilisant, lorsque les quotas et conditions le permettent, les offres gratuites des différents services.

```text
                    Internet
                       │
                       ▼
              ┌────────────────┐
              │    Vercel      │
              │   Frontend     │
              └───────┬────────┘
                      │
                  HTTPS / SSE
                      │
                      ▼
              ┌────────────────┐
              │ Render /       │
              │ Railway        │
              │ FastAPI        │
              └───────┬────────┘
                      │
             ┌────────┴────────┐
             ▼                 ▼
      ┌──────────────┐   ┌───────────────┐
      │  Supabase    │   │ LLM Providers │
      │ PostgreSQL   │   │ APIs           │
      │ + pgvector   │   │                │
      └──────────────┘   └───────────────┘
```

### Frontend

- Vercel Free Tier
- ou Netlify Free Tier

### Backend

- Render
- ou Railway

Le choix final doit dépendre des quotas, de la disponibilité des instances et des limitations du plan utilisé au moment du déploiement.

### Base de données

- Supabase PostgreSQL
- `pgvector`
- `pg_trgm`

Les limites de stockage et de calcul doivent être vérifiées selon le plan effectivement utilisé.

---

# 10. Principes de Sécurité

La plateforme doit également intégrer :

- authentification et autorisation ;
- isolation des workspaces ;
- validation stricte des entrées avec Pydantic ;
- gestion sécurisée des secrets via variables d’environnement ;
- limitation du débit des endpoints ;
- contrôle des fichiers uploadés ;
- protection contre les injections dans les prompts ;
- filtrage des données sensibles ;
- logs sans exposition de secrets ou de données confidentielles.

Les clés API des fournisseurs LLM ne doivent jamais être exposées dans le frontend.

```text
Frontend
   │
   │ Request
   ▼
Backend
   │
   ├── Auth
   ├── Validation
   ├── RAG
   ├── Router
   │
   ▼
Provider API
```

---

# 11. Résumé de l’Architecture

L’architecture finale de Fuzyo repose donc sur cinq couches principales :

```text
┌───────────────────────────────────────────────┐
│                 USER INTERFACE                │
│          React + Vite + Tailwind              │
└───────────────────────┬───────────────────────┘
                        │
                    HTTP / SSE
                        │
┌───────────────────────▼───────────────────────┐
│              APPLICATION LAYER                │
│              FastAPI + Pydantic               │
└───────────────┬─────────────────┬─────────────┘
                │                 │
                ▼                 ▼
┌────────────────────────┐ ┌─────────────────────┐
│       RAG LAYER        │ │    LLM ROUTER       │
│                        │ │                     │
│ pgvector               │ │ Cerebras            │
│ PostgreSQL FTS         │ │ Groq                │
│ Hybrid Search          │ │ Gemini              │
│ RRF                    │ │ Mistral             │
│ Reranking              │ │ SambaNova           │
└────────────┬───────────┘ │ OpenRouter          │
             │             └──────────┬──────────┘
             ▼                        │
┌────────────────────────┐            │
│     DATA LAYER         │            │
│ PostgreSQL / Supabase  │            │
└────────────────────────┘            │
                                      ▼
                              External LLM APIs
```

Cette architecture fournit une base modulaire, extensible et orientée **AI-assisted Software Development / SDLC**, tout en permettant d’intégrer progressivement de nouveaux modèles, fournisseurs, outils RAG et fonctionnalités sans modifier profondément le frontend.