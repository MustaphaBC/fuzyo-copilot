# Spécification Fonctionnelle Détaillée (SFD) — Fuzyo

## 1. Module Rôles & Confidentialité (Privacy Dispatcher)
* **SFD-01 : Commutateur UI Manuel (Force Confidential Mode)**
  * L'utilisateur peut activer un bouton "Mode Confidentiel" dans l'UI.
  * *Comportement :* Bypasse tous les appels API Cloud. Toutes les requêtes sont directement acheminées vers le client stub local (`MockLocalLLMClient`).
* **SFD-02 : Classifier Automatique de Confidentialité**
  * En mode "Auto", chaque prompt est analysé par un micro-classifieur (Regex d'API Keys/IPs + parsing LLM Cerebras < 150ms).
  * Si un score de sensibilité > 0.7 est détecté, la requête est redirigée vers le modèle local stubbed.

## 2. Assistant SDLC & Cartographie des Modèles
* **SFD-03 : Sélection de la Phase SDLC**
  * L'utilisateur peut sélectionner la phase active (1 parmi 9). Par défaut, chaque phase utilise un modèle prédéfini :
    * *Expression du besoin / Analyse Fonctionnelle / Architecture / Recette / Mise en prod :* **Google Gemini API**
    * *Gestion de projet / Tests & QA / DevOps :* **Groq API (Llama 3.3 70B)**
    * *Développement :* **Mistral AI (Codestral)** / **SambaNova Cloud**
  * L'utilisateur conserve la possibilité de surcharger le modèle par défaut via un menu déroulant.

## 3. Module de Contrôle Qualité (Quality Gatekeeper)
* **SFD-04 : Validation Progressive à 3 Niveaux**
  * *Niveau 1 (Validation de Schéma) :* Validation Pydantic de la structure JSON/Markdown.
  * *Niveau 2 (Audit Statique) :* Scripts regex détectant le code tronqué, les blocs de code vides ou les mentions "TODO".
  * *Niveau 3 (LLM-as-a-Judge) :* En cas d'anomalie, un appel rapide Groq évalue la réponse sur une échelle de 1 à 10. Si score < 7, une boucle de re-prompt automatique est exécutée.

## 4. Module RAG Auxiliaire & Ingestion
* **SFD-05 : Recherche Hybride & Reranking**
  * Exécution d'une fonction SQL sur Supabase combinant la recherche vectorielle (`pgvector`) et la recherche textuelle (`tsvector`) via Reciprocal Rank Fusion (RRF).
  * Re-scoring des 20 meilleurs résultats en mémoire CPU via `FlashRank` ou l'API Cohere Rerank.
* **SFD-06 : Ingestion Documentaire Multi-Formats**
  * Prise en charge des fichiers PDF, Word, Excel et Markdown via `BaseDocumentLoader`.

## 5. Compétences Agentiques (Skills Engine)
* **SFD-07 : Commandes /Skills**
  * `/plan` : Génération de roadmaps, découpage de tâches et backlog de sprint.
  * `/analyze` : Analyse d'écarts, étude de faisabilité et matrices d'impact.
  * `/review` : Audit de code, vérification de la conformité des specs et sécurité.
  * `/debug` : Parsing de stack traces, analyse de cause racine et génération de patchs git diff.

## 6. Espaces de Travail (Workspaces CRUD) & Tableau de Bord
* **SFD-08 : Gestion des Projets (CRUD)**
  * Création (`/create`), Édition (`/edit`), et Suppression (`/delete`) d'espaces de travail isolés.
* **SFD-09 : Analytics & Dashboard**
  * Suivi du pourcentage d'avancement sur les 9 phases SDLC.
  * Détection automatique des langages et technologies utilisés.
  * Calcul d'indicateurs de couverture documentaire et de testabilité du code.