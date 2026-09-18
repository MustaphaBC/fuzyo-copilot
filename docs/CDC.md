# Cahier des Charges (CDC) — Fuzyo SDLC AI Assistant

## 1. Contexte & Vision du Projet
Le projet **Fuzyo SDLC AI Assistant** vise à créer une plateforme d'assistance intelligente et souveraine capable d'accompagner l'ensemble des acteurs logiciels (Product Owners, Architectes, Développeurs, QA, DevOps) sur les 9 phases du cycle de vie du développement logiciel (SDLC) :

1. Expression du besoin
2. Analyse fonctionnelle
3. Architecture
4. Gestion de projet / PO
5. Développement
6. Tests & QA
7. Recette
8. DevOps / CI-CD
9. Mise en production

## 2. Objectifs Stratégiques
* **Prototype Zero-Cost :** Déploiement initial reposant exclusivement sur des tiers gratuits (Cloud APIs, Supabase Free Tier, Vercel/Render).
* **Router Hybride & Protection des Données :** Détection automatique des données confidentielles/secrets pour orienter le traitement vers un modèle local (stubbed `MockLocalLLMClient` pour la phase MVP) ou vers des API Cloud gratuites.
* **Contrôle Qualité Automatisé :** Garantir des réponses répondant aux normes d'ingénierie logicielle grâce à un système de validation progressive à 3 niveaux.
* **Support RAG Sur Mesure :** Module RAG hybride auxiliaire pour l'interrogation de la documentation projet (PDF, Word, Markdown, Excel).

## 3. Périmètre & Utilisateurs Cibles
* **Utilisateurs Cibles :** Équipes d'ingénierie logicielle, Tech Leads, PO, Ingenieurs DevOps et QA.
* **Périmètre Fonctionnel Initial (MVP) :**
  * Interface Chat interactive avec gestion d'Espaces de Travail (Workspaces CRUD).
  * Aiguilleur d'intentions et de confidentialité (Router Local vs Cloud).
  * Orchestration multi-modèles cloud (Gemini, Groq, Cerebras, SambaNova, Mistral, Cohere, OpenRouter).
  * Module d'évaluation de la qualité des réponses (Gatekeeper).
  * Moteur de compétences (/plan, /analyze, /review, /debug).
  * Tableau de bord d'avancement des phases SDLC et statistiques.

## 4. Exigences Non-Fonctionnelles
* **Coût d'Infrastructures :** 0€ (Utilisation stricte des tiers gratuits).
* **Souveraineté des Données :** Possibilité de forcer le mode local/confidentiel via un toggle UI manuel.
* **Performance :** Temps de classification et de routage < 200 ms. Temps de génération initiale < 2s via streaming SSE.
* **Extensibilité :** Architecture découplée permettant l'intégration ultérieure de connecteurs GitHub/Jira et de véritables modèles locaux (Ollama/LM Studio).