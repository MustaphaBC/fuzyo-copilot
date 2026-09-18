# Fuzyo Copilot — Rapport de restitution

**Assistant SDLC souverain — 9 phases du cycle de vie logiciel**

FUZYO France SAS · Prototype opérationnel 2026  
Document de restitution métier et technique  
Sources : CDC, SFD, DAT, ROADMAP et code du dépôt `FUZYO COPILOT_2`

---

## 1. Page de garde — objet du document

Ce rapport décrit **Fuzyo Copilot**, plateforme d’assistance intelligente qui accompagne une équipe logicielle (ESN, produit interne, stage PFE) sur **neuf phases SDLC** personnalisées par FUZYO.

Il s’adresse à deux lecteurs :

- le **décideur** (CEO, Tech Lead) : vision, ROI, risques, recommandations d’adoption ;
- l’**ingénieur / encadrant académique** : architecture, stack, flux SSE, RAG, gatekeeper, cartographie UI.

Le document reflète l’état **réel du code**, pas uniquement le CDC. Les écarts (prévu vs livré) sont explicités à la section 14.

---

## 2. Synthèse exécutive

**Problème.** Les équipes de delivery (forfait + régie) perdent du temps sur des artefacts répétitifs (CDC, SFD, DAT, tests, pipelines) tout en exposant le code client à des LLM cloud non maîtrisés.

**Solution.** Fuzyo Copilot est un **assistant de chat orienté SDLC** :

- 9 phases nommées (Expression du besoin → Mise en production) ;
- **routage de confidentialité** (toggle Confidential + détection de secrets + score Cerebras) vers un stub local lorsque le cloud est interdit ;
- **orchestration multi-LLM** (Gemini, Groq, Mistral Codestral, Cerebras, SambaNova, OpenRouter) selon la phase ;
- **RAG hybride** (pgvector + full-text + FlashRank) sur les documents du workspace ;
- **gatekeeper 3 niveaux** après chaque réponse ;
- **workspaces** isolés, dashboard d’audit, IDE local, export de livrables.

**État.** Le MVP est **opérationnel** : chat SSE, privacy router, RAG, analytics, IDE, Execute Phase Assistant, démo Playwright A–Z. Ce qui n’est **pas** livré : Ollama réel, retry automatique du gatekeeper, moteur de skills backend, connecteurs GitHub/Jira, export PDF.

**Stack clé.** React 19 + Vite 6 · FastAPI · Supabase PostgreSQL/pgvector · Cohere Embed · Playwright.

![Chat et composer](assets/screenshots/02-chat-composer.png)

*Figure 1 — Shell principal : sidebar projets/chats, fil de conversation, composer (phase SDLC, Confidential, modèle, Send).*

---

## 3. Contexte, objectifs et rôles

### 3.1 Vision (CDC)

Fuzyo vise une assistance **souveraine** : les secrets et le code sensible ne doivent jamais partir sur un cloud non choisi. Le prototype s’appuie sur des **tiers gratuits** (APIs cloud, Supabase Free) pour un coût d’infrastructure proche de 0 €.

### 3.2 Objectifs stratégiques

| Objectif | Traduction produit |
|---|---|
| Prototype zero-cost | Clés API optionnelles, catalogue de modèles filtré par clé présente |
| Protection des données | `force_confidential`, regex secrets, classifieur Cerebras, `MockLocalLLMClient` |
| Qualité des sorties | Gatekeeper T1 structure, T2 heuristiques, T3 juge Groq |
| Mémoire projet | RAG + filesystem `workspace_projects/` |
| Accélération SDLC | Prompts système par phase + meta-prompts Execute Phase |

### 3.3 Utilisateurs et RBAC

Rôles implémentés dans `backend/app/core/rbac.py` :

| Rôle | Intention |
|---|---|
| `developer` | Usage quotidien chat / code / tests (défaut) |
| `tech_lead` | Architecture, revues |
| `product_owner` | Besoin, backlog, recette |
| `admin` | Seul autorisé à « deploy to production » et purge RAG |

Les intents admin-only sont interceptés **avant** l’appel LLM (`agent_runner.intercept_admin_tools`). Un développeur qui demande un déploiement production reçoit une carte de verrouillage, pas un pipeline.

---

## 4. Périmètre fonctionnel

| Module | Ce que l’utilisateur peut faire |
|---|---|
| Authentification | Sign in / Create account (Supabase Auth) ; bypass E2E `Bearer e2e` |
| Workspaces | Créer, éditer, supprimer un projet ; instructions custom ; stack déclarée ; ingest dossier hôte |
| Chat SDLC | Choisir la phase 1–9, envoyer un prompt, recevoir un flux SSE |
| Confidential | Forcer le stub local ; le backend reroute aussi si secrets / sensibilité > 0,7 |
| Modèle | Auto (mapping phase) ou override Groq / Gemini / Cerebras / SambaNova / Mistral |
| Skills (UI) | Modes Cowork `/plan` `/analyze` `/review` `/debug` — préfixe texte, **pas** de moteur backend dédié |
| RAG | Joindre PDF/DOCX/XLSX/MD ; recherche hybride injectée dans le prompt |
| Inspector | Routing, RAG, scores qualité, latence |
| Canvas | Diagrammes Mermaid, preview HTML, code |
| Artifacts | Bibliothèque des réponses riches du workspace |
| Dashboard | Scan projet, graphe 9 phases, scores, Execute Phase Assistant, download livrable |
| IDE | Explorateur + Monaco + chat agent + diff Accept/Reject |
| Livrables | DOCX (phases documentaires), ZIP (code/tests), MD/raw |

![Écran d’authentification](assets/screenshots/01-auth.png)

*Figure 2 — Porte d’entrée : Sign in / Create account (session Supabase).*

---

## 5. Parcours de développement

Le dépôt n’est pas un historique Git public ; le **ROADMAP.md** et le code constituent la chronologie.

| Étape ROADMAP | Livré dans le code |
|---|---|
| Phase 1 — Squelette FastAPI + Vite/Tailwind | `backend/app/main.py`, `frontend/` |
| Phase 2 — Config Pydantic + schémas | `core/config.py`, `schemas/chat.py`, `schemas/workspace.py` |
| Phase 3 — Bibliothèque de prompts | `prompts/sdlc_prompts.py`, `eval_prompts.py` |
| Phase 4 — Clients LLM + privacy router | `cloud_providers.py`, `local_stub.py`, `privacy_router.py` |
| Phase 5 — Gatekeeper 3 niveaux | `gatekeeper.py` (évaluation ; **pas** de boucle de re-prompt) |
| Phase 6 — RAG Supabase | migrations `01`–`06`, `ingestion.py`, `rag_service.py` |
| Phase 7 — SSE + workspaces/analytics | `api/chat.py`, `api/workspaces.py` |
| Phase 8 — UI React | Chat, sidebar, inspector, canvas, dashboard |
| Phase 9+ — FS, IDE, livrables, e2e live | `workspace_fs`, `IdeWorkspace`, `deliverable_exporter`, Playwright 9 phases |
| Catalogue Phase 2 (benchmark PFE) | `sdlcPhaseMetaPrompts.js` branché sur Execute Phase Assistant |

---

## 6. Workflow A–Z

![Workflow A-Z](assets/screenshots/d3-workflow.png)

*Figure 3 — Parcours nominal d’un projet dans Fuzyo.*

1. **Authentification** (Supabase) — session JWT transmise aux API (`Authorization: Bearer`).
2. **Créer un projet** — nom, description, stack, instructions, éventuellement un chemin hôte (`create-and-ingest`).
3. **Choisir la phase SDLC** dans le composer (ou via le graphe dashboard).
4. **Prompt** — éventuellement pièce jointe RAG ; option Confidential ; option modèle.
5. **SSE** — événements `routing` → `rag` → `token` → `quality` (parfois `admin_restricted`).
6. **Exploitation** — Copy, Save to Local PC, Apply & Sync to host, Canvas Mermaid.
7. **Scan project** — analyse FS, pourcentages de phase, scores qualité.
8. **Execute Phase Assistant** — meta-prompt 5 blocs prérempli, **non envoyé** automatiquement.
9. **Download** — CDC `.docx`, pack architecture, ZIP de code, etc.
10. **IDE** — éditer le disque du workspace, accepter/refuser un diff.

![Dashboard SDLC](assets/screenshots/05-dashboard-sdlc.png)

*Figure 4 — Command center : langages, graphe des 9 phases, scores d’audit, Scan project.*

---

## 7. Catalogue des interactions UI

| Contrôle | Fichier | Effet | API |
|---|---|---|---|
| Sign in / Create account | `AuthScreen.jsx` | Session Supabase | Auth SDK (hors REST Fuzyo) |
| New chat | `Sidebar.jsx` | Nouveau thread | `POST .../threads` |
| New project | `CreateWorkspaceModal.jsx` | Crée + ingest optionnel | `POST /workspaces` ou `create-and-ingest` |
| Projects (picker) | `Sidebar.jsx` | Ouvre le dashboard analytics | `GET .../analytics` |
| Clic nom de projet | `Sidebar.jsx` | Ouvre l’IDE | `GET .../fs/tree` |
| Artifacts | `ArtifactsBrowser.jsx` | Liste des artefacts chat | État client |
| Customize | `WorkspaceModal.jsx` | Éditer projet / docs | `PUT /workspaces/{id}` |
| Phase SDLC | `ChatContainer.jsx` | `sdlcPhase` 1–9 | champ `sdlc_phase` |
| Confidential | Composer | `force_confidential` | chat completions |
| Model | `ModelSelector.jsx` | Override provider:model | `GET /models/available` |
| Attach | Composer | Upload document RAG | `POST .../documents` |
| Chat / Cowork | Composer | Affiche les chips `/plan`… | préfixe prompt |
| Send / Stop | Composer | Lance / annule le SSE | `POST /chat/completions` |
| Inspector | `InspectorDrawer.jsx` | Méta routing/RAG/qualité | événements SSE |
| Canvas | `CanvasDrawer.jsx` | Diagramme / preview / code | client |
| Save to Local PC | `SaveLocalButton.jsx` | Écrit un fichier phase | `POST .../save-artifact` |
| Apply & Sync to host | `CodeDiffViewer.jsx` | Écrit le FS hôte | `POST .../apply-changes` |
| Scan project | `AnalyticsDashboard.jsx` | Recalcule l’audit | `GET .../analytics?refresh=1` |
| Nœud de phase | `SDLCWorkflowGraph.jsx` | Tiroir livrables | — |
| Execute Phase Assistant | `ProjectOverviewDashboard.jsx` | Seed composer + `setSdlcPhase` | — (ensuite chat) |
| Download livrable | `DeliverableDownloadButton.jsx` | Fichier phase | `GET .../deliverables/{phase}/download` |
| Command palette ⌘K | `CommandPalette.jsx` | Navigation / thèmes / fichiers | optionnel `fs/file` |

![Tiroir de phase](assets/screenshots/06-phase-drawer.png)

*Figure 5 — Tiroir : statut, livrables détectés, download, Execute Phase Assistant.*

![Execute Phase](assets/screenshots/07-execute-phase-prompt.png)

*Figure 6 — Après Execute Phase : composer rempli avec [RÔLE] [CONTEXTE] [OBJECTIF] [CONTRAINTES] [FORMAT DE SORTIE]. L’envoi reste manuel.*

---

## 8. Architecture technique

![Architecture](assets/screenshots/d1-architecture.png)

*Figure 7 — Couches Frontend / FastAPI / RAG / LLM / filesystem.*

### 8.1 Frontend

SPA React (`App.jsx`) derrière `AuthGate`. `viewMode` : `chat` | `dashboard` | `artifacts` | `ide` | `customize`. État global : `AppContext`, `AuthContext`, `UIContext`, `ArtifactContext`. Proxy Vite `/api` → FastAPI.

### 8.2 Backend

FastAPI (`main.py`) monte :

- `/api/v1/chat/completions` — SSE
- `/api/v1/workspaces` — CRUD, documents, analytics, save-artifact, apply-changes
- `/api/v1/workspaces/{id}/fs/*` — arbre et fichiers
- `/api/v1/deliverables/{phase}/download`
- `/api/v1/threads`, historique
- `/api/v1/models/available`
- `GET /health`

### 8.3 Données

- **Supabase Postgres** : workspaces, `document_chunks` (embedding + FTS), threads/messages, profiles, `sdlc_audit_report`.
- **Disque** : `workspace_projects/<slug>__<id>/` (ou chemin hôte custom), conventions `docs/`, `src/`, `tests/`, `.github/workflows/`.
- **Navigateur** : localStorage (thème, messages de secours).

---

## 9. Stack technologique

### 9.1 Backend (`requirements.txt`)

FastAPI, Uvicorn, Pydantic v2, HTTPX, Supabase, python-dotenv, pypdf, python-docx, openpyxl, FlashRank, python-multipart, PyJWT, cryptography.

### 9.2 Frontend (`package.json`)

React 19, Vite 6, Tailwind 3, Lucide, Mermaid 11, Monaco Editor, Supabase JS, react-markdown + remark-gfm, JSZip, Playwright.

### 9.3 LLM et embeddings

| Fournisseur | Usage dans Fuzyo |
|---|---|
| Gemini 3.6 Flash | Défaut phases 1, 2, 3, 7, 9 |
| Groq (`openai/gpt-oss-120b`) | Défaut phases 4, 6, 8 ; juge T3 |
| Mistral Codestral | Défaut phase 5 (développement) |
| Cerebras Llama 3.1 8B | Classifieur de sensibilité |
| SambaNova Llama 3.3 70B | Catalogue, override |
| OpenRouter | Fallback 404/429/502/503 |
| Cohere embed-v4 | Embeddings RAG |
| `MockLocalLLMClient` | Chemin confidentiel / 402 billing — **pas Ollama** |

---

## 10. Rôle des services majeurs

| Service | Fichier | Rôle |
|---|---|---|
| Privacy router | `privacy_router.py` | Décide LOCAL_STUB vs CLOUD_API |
| Cloud providers | `cloud_providers.py` | Streaming HTTPX par fournisseur |
| Local stub | `local_stub.py` | Jetons `[LOCAL MOCK EXECUTION]` |
| RAG | `rag_service.py` + `ingestion.py` | Chunk, embed, `hybrid_search_rrf`, FlashRank |
| Gatekeeper | `gatekeeper.py` | T1/T2 locaux, T3 Groq si échec |
| Chat API | `chat.py` | Orchestre SSE, fallback OpenRouter, 402 → stub |
| Workspace FS | `workspace_fs.py` | Arbre/lecture/écriture sandboxés |
| Analytics | `analytics_engine.py` + `project_analyzer.py` | Phases %, langages, scores |
| Deliverables | `deliverable_exporter.py` | DOCX/ZIP/MD (PDF refusé) |
| RBAC | `rbac.py` + `agent_runner.py` | Outils admin-only |
| Meta-prompts | `sdlcPhaseMetaPrompts.js` | Prompts Execute Phase, 5 composantes, stack-aware |

![Inspector](assets/screenshots/03-inspector.png)

*Figure 8 — Inspector : client, provider, sensibilité, secrets, statut RAG, Tiers 1–3, latence.*

---

## 11. SDLC : neuf phases et double couche de prompts

| Ph. | Nom UI | Prompt système (backend) | Livrable typique |
|---|---|---|---|
| 1 | Expression du besoin | Personas, user stories, AC | CDC `.docx` |
| 2 | Analyse fonctionnelle | FR-xx + JSON features | SFD |
| 3 | Architecture | Mermaid obligatoire + ADR | DAT / `.mermaid` |
| 4 | Gestion de projet / PO | Backlog tableau Fibonacci | Plan de sprint |
| 5 | Développement | Code complet, pas de TODO | ZIP `src/` |
| 6 | Tests & QA | Tables de cas + scripts | ZIP `tests/` |
| 7 | Recette | Checklists UAT Given/When/Then | Cahier de recette |
| 8 | DevOps / CI-CD | YAML/Dockerfile complets | Pipeline |
| 9 | Mise en production | Release, rollback, monitoring | Runbook |

**System prompts** (`sdlc_prompts.py`) : contrats de *format* envoyés en `system` à chaque completion.

**Meta-prompts Execute Phase** (`sdlcPhaseMetaPrompts.js`) : briefs professionnels français injectés dans le *user* composer. Ils interpolent le workspace (nom, description, stack déclarée/détectée, livrables, instructions) et un hint Web / Mobile / mixte / inconnu. Ils n’imposent **pas** le scénario e-commerce B2B ni Flutter technicien du guide académique Phase 2.

---

## 12. Architecture de l’assistant IA

![Séquence SSE](assets/screenshots/d2-sse.png)

*Figure 9 — Séquence d’une completion : routing, RAG, tokens, quality.*

### 12.1 Décision de routage

1. Toggle Confidential ou `FORCE_LOCAL_MOCK` → stub.
2. Regex (clés OpenAI/GitHub, IP, mots de passe, SSH, AKIA, Bearer) → stub (labels seuls, jamais la valeur).
3. Score Cerebras > 0,7 → stub.
4. Sinon mapping phase → provider, éventuellement override UI.
5. RAG si `workspace_id` est présent (décision cloud).

### 12.2 Contexte

- Historique du thread (`history_window`).
- Snippets RAG rerankés.
- System prompt de phase.
- Préfixe skill UI si Cowork.

### 12.3 Décision modèle

Auto = table `_PHASE_PROVIDER_MAP`. Fallback : erreur HTTP 404/429/502/503 → OpenRouter ; **402 billing** → stub + bandeau d’avertissement (pas de fuite de secrets).

### 12.4 Qualité

Après assemblage du texte : T1 (clôture des fences, JSON, tables) ; T2 (TODO, `pass`, code tronqué) ; T3 juge Groq **seulement** si T1 ou T2 échoue. Le score part en SSE `quality`. **Aucune régénération automatique** (écart vs SFD-04).

### 12.5 « Agents »

Il n’y a pas d’orchestrateur multi-agents type Crew. Un **seul** flux chat, avec :

- un routeur de confidentialité ;
- un intercept RBAC ;
- quatre skills UI (préfixes) ;
- des outils d’écriture FS (save/apply) déclenchés par l’utilisateur.

---

## 13. Décisions de conception

| Décision | Pourquoi |
|---|---|
| SSE plutôt que WebSocket | Aligné CDC : événements typés `routing/rag/token/quality`, simple à proxifier |
| Stub local plutôt qu’Ollama en MVP | Zéro GPU, déterministe, respect strict `force_confidential` |
| Hybrid RAG + FlashRank CPU | Supabase free + rerank sans GPU |
| Mapping phase → modèle | Gemini pour specs/archi, Groq pour PO/QA/DevOps, Codestral pour le code |
| Execute Phase sans auto-send | L’utilisateur relit le meta-prompt (qualité C1/C2 du benchmark) |
| PDF non supporté | Export DOCX/ZIP/MD uniquement ; PDF explicitement rejeté |
| E2E `Bearer e2e` | Démos Playwright sans secrets Supabase |
| Fences `lang path` | Apply-to-host déterministe (`docs/`, `src/`, `tests/`, `.github/`) |

---

## 14. État d’implémentation

| Capacité | Statut |
|---|---|
| Chat SSE + historique threads | Fait |
| Privacy router + Confidential | Fait |
| Multi-LLM + OpenRouter + 402→stub | Fait |
| RAG ingest + hybrid search | Fait |
| Gatekeeper T1–T3 (feedback) | Fait |
| Re-prompt automatique si T3 < 7 | **Non fait** (SFD-04 partiel) |
| Dashboard + scan + graphe 9 phases | Fait |
| Execute Phase meta-prompts | Fait |
| IDE Monaco + apply/save | Fait |
| Download DOCX/ZIP/MD | Fait |
| Export PDF | **Non fait** |
| Skills `/plan` etc. backend | **UI seulement** |
| Ollama / LM Studio | **Non fait** (stub uniquement) |
| Connecteurs GitHub / Jira | **Prévu CDC, absent** |
| RBAC admin tools | Fait |
| Démo Playwright 9 phases live | Fait |

![IDE](assets/screenshots/09-ide.png)

*Figure 10 — IDE : explorateur, éditeur, panneau agent.*

![Artifacts](assets/screenshots/08-artifacts.png)

*Figure 11 — Artifacts : réponses Mermaid/code/HTML réutilisables.*

---

## 15. Défis, solutions, leçons

| Défi | Solution | Leçon |
|---|---|---|
| Fuite de secrets vers le cloud | Regex + Cerebras + toggle + stub | Ne jamais logger la valeur du secret, seulement le label |
| HTTP 402 (crédits cloud) | Bascule stub + notice billing | Distinguer 402 des 429 (OpenRouter) |
| Mermaid cassé (IDs numériques) | Règles strictes dans le prompt phase 3 | Le renderer est intolerant ; le prompt est une spec |
| Auth bloquante pour les démos | `FUZYO_E2E_AUTH_BYPASS` + JWT e2e | Séparer démo et prod |
| Apply-to-host trop permissif | Allowlist de préfixes + `relative_path` | Le fence info est un contrat |
| Prompts Execute Phase trop génériques | Catalogue 5 composantes, contextuel | Un rôle + un format battent un one-liner anglais |
| Skills « agentiques » sur-vendues | Documenter l’écart UI vs backend | Honnêteté du statut > démo marketing |

---

## 16. Scénario de démonstration (Todo A–Z)

Aligné sur `frontend/e2e/full_sdlc_todo_simulation.spec.js` (ports démo 5180/8010, vidéo headed).

1. Authentification (ou bypass E2E).
2. Créer le workspace `todo_master` (host path `e2e_test_workspaces/todo_master`).
3. **Ph.01** — CDC / expression du besoin → Save to Local.
4. **Ph.02** — SFD / user stories.
5. **Ph.03** — DAT + Mermaid → Canvas → download architecture.
6. **Ph.04** — Sprint backlog + risques.
7. **Ph.05** — Code (`src/`) → Apply & Sync to host.
8. **Ph.06** — Tests.
9. **Ph.07** — Cahier UAT.
10. **Ph.08** — GitHub Actions YAML.
11. **Ph.09** — Runbook production.
12. **Scan project** — graphe 9 nœuds, progression visible.
13. **Execute Phase** sur une phase restante : montrer le meta-prompt 5 blocs, puis Send.
14. Télécharger le CDC `.docx`.

Durée indicative de la simulation complète : ~4 minutes en headed `slowMo`. Pour une restitution CEO : 8–10 minutes en commentant Inspector + Confidential.

![Canvas Mermaid](assets/screenshots/04-canvas-mermaid.png)

*Figure 12 — Canvas : diagramme d’architecture exploitable hors du fil de chat.*

![Apply / Save](assets/screenshots/10-apply-save.png)

*Figure 13 — Actions sur un artefact code : Apply to workspace, Apply & Sync to host, Save to Local PC.*

---

## 17. Annexes

### A. Endpoints REST principaux

| Méthode | Chemin |
|---|---|
| GET | `/health` |
| POST | `/api/v1/chat/completions` |
| GET/POST | `/api/v1/workspaces` |
| POST | `/api/v1/workspaces/create-and-ingest` |
| GET | `/api/v1/workspaces/{id}/analytics` |
| POST | `/api/v1/workspaces/{id}/documents` |
| POST | `/api/v1/workspaces/{id}/save-artifact` |
| POST | `/api/v1/workspaces/{id}/apply-changes` |
| GET/PUT | `/api/v1/workspaces/{id}/fs/tree` · `fs/file` |
| GET | `/api/v1/deliverables/{phase}/download` |
| GET | `/api/v1/models/available` |
| GET/POST | `/api/v1/workspaces/{id}/threads` |

### B. Mapping phase → provider (défaut Auto)

| Phase | Provider | Modèle |
|---|---|---|
| 1, 2, 3, 7, 9 | gemini | gemini-3.6-flash |
| 4, 6, 8 | groq | openai/gpt-oss-120b |
| 5 | mistral | codestral-latest |

### C. Événements SSE

`routing` · `rag` · `token` · `quality` · `admin_restricted`

### D. Lancement local

`start.ps1` — API `127.0.0.1:8000`, UI `127.0.0.1:5173`.

### E. Fichiers de référence

`CDC.md`, `SFD.md`, `DAT.md`, `ROADMAP.md`, `.cursor/rules/fuzyo-master-orchestrator.mdc`

---

*Fin du rapport — Fuzyo Copilot, restitution 2026.*
