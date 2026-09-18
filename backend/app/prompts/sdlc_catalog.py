"""Canonical FUZYO SDLC phase catalog: objectives, deliverables, elite roles."""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping


@dataclass(frozen=True, slots=True)
class SdlcPhaseCatalogEntry:
    id: int
    name: str
    key_question: str
    objective: str
    expected_deliverables: tuple[str, ...]
    default_role: str
    domain_expertise: str
    output_format: str
    export_title: str


_PHASES: tuple[SdlcPhaseCatalogEntry, ...] = (
    SdlcPhaseCatalogEntry(
        id=1,
        name="Expression du besoin",
        key_question="Pourquoi ce projet et quel problème résout-il ?",
        objective=(
            "Clarifier la vision produit, le problème métier, les acteurs et le cadre "
            "du besoin avant toute spécification détaillée."
        ),
        expected_deliverables=(
            "Cahier des Charges (CDC) préliminaire",
            "Vision Produit",
            "Note de contexte",
            "Cartographie des acteurs",
            "Épopées initiales",
            "Glossaire métier",
        ),
        default_role="Business Analyst Senior",
        domain_expertise="product discovery, stakeholder analysis, and needs elicitation",
        output_format=(
            "Document Markdown structuré avec sections: # Vision, # Objectifs, # Personas, "
            "# Actors Map, # Epics, # Glossaire, # Open Questions. "
            "User stories au format « As a … I want … so that … » avec critères d'acceptation testables."
        ),
        export_title="Expression du besoin / CDC",
    ),
    SdlcPhaseCatalogEntry(
        id=2,
        name="Analyse fonctionnelle",
        key_question="Que doit faire précisément le logiciel ?",
        objective=(
            "Traduire le besoin en spécifications fonctionnelles détaillées, backlog "
            "priorisé et traçabilité des exigences."
        ),
        expected_deliverables=(
            "Spécifications Fonctionnelles Détaillées (SFD)",
            "Product Backlog priorisé",
            "Diagrammes UML",
            "Matrice de traçabilité des exigences",
            "Maquettes fonctionnelles",
        ),
        default_role="Business Analyst Senior / Functional Spec Lead",
        domain_expertise="functional analysis, UML modeling, and requirements traceability",
        output_format=(
            "Markdown avec exigences numérotées (FR-01, FR-02, …) et sections NFR. "
            "Inclure un bloc JSON fenced listant: id, name, priority, description. "
            "Diagrammes UML en PlantUML ou Mermaid lorsque pertinent."
        ),
        export_title="Analyse fonctionnelle",
    ),
    SdlcPhaseCatalogEntry(
        id=3,
        name="Architecture technique",
        key_question="Comment le système sera-t-il construit techniquement ?",
        objective=(
            "Définir l'architecture cible, les frontières de composants, les données "
            "et les décisions techniques structurantes."
        ),
        expected_deliverables=(
            "Dossier d'Architecture Technique (DAT)",
            "Schéma de BDD (MCD/MPD)",
            "Architecture Decision Records (ADR)",
            "PoC technique",
            "Spécifications des APIs (OpenAPI)",
        ),
        default_role="Lead System Architect",
        domain_expertise="Clean Architecture, API design, and technical decision records",
        output_format=(
            "Au moins un diagramme Mermaid dans un bloc ```mermaid (flowchart, sequenceDiagram "
            "ou C4-style). Règles Mermaid strictes: flowchart TD ou LR; ids lettres/underscore "
            "uniquement (jamais de chiffre en tête); subgraphs avec subgraph id [\"Title\"] puis end. "
            "Suivre d'un DAT Markdown (composants, interfaces, risques, ADR)."
        ),
        export_title="Architecture",
    ),
    SdlcPhaseCatalogEntry(
        id=4,
        name="Gestion de projet / PO",
        key_question="Comment piloter l'exécution et ordonnancer les priorités ?",
        objective=(
            "Ordonnancer le backlog, planifier les sprints et exposer risques "
            "et avancement de façon actionnable."
        ),
        expected_deliverables=(
            "Product Backlog priorisé (Story Points)",
            "Plan de Sprint",
            "Rapports d'avancement (Burndown)",
            "Matrice des risques",
            "Compte-rendus de Sprint",
        ),
        default_role="Senior Product Owner",
        domain_expertise="agile delivery, backlog prioritization, and risk management",
        output_format=(
            "Tables Markdown pour le backlog (ID, Title, Priority, Estimate, Sprint, Dependencies). "
            "Résumé scope / risques / next actions. Estimations relatives concrètes (pas de TBD vides)."
        ),
        export_title="Gestion de projet / PO",
    ),
    SdlcPhaseCatalogEntry(
        id=5,
        name="Développement",
        key_question="Comment implémenter les fonctionnalités planifiées ?",
        objective=(
            "Livrer du code production-ready, versionnable, testable et documenté "
            "selon DDD/SOLID."
        ),
        expected_deliverables=(
            "Code source versionné (Git)",
            "Modules fonctionnels",
            "Tests unitaires (couverture 70-80%)",
            "Documentation technique (JSDoc/Swagger)",
            "Pull Requests revues",
        ),
        default_role="Senior Software Engineer",
        domain_expertise="Clean Architecture, DDD, SOLID, and production-grade implementation",
        output_format=(
            "Code source complet dans des blocs fenced avec language tags. "
            "Modules/fonctions complets, zéro placeholder TODO. "
            "Explication Markdown minimale seulement après le code si nécessaire."
        ),
        export_title="Développement",
    ),
    SdlcPhaseCatalogEntry(
        id=6,
        name="Tests & QA",
        key_question="Le système fonctionne-t-il correctement et sans régressions ?",
        objective=(
            "Garantir la non-régression via stratégie de tests, cas exécutables "
            "et preuves de couverture."
        ),
        expected_deliverables=(
            "Plan de tests",
            "Rapport d'exécution des tests",
            "Registre des bugs",
            "Rapport de couverture de code",
        ),
        default_role="SDET Engineer / Senior QA",
        domain_expertise="test strategy, automation, coverage analysis, and defect tracking",
        output_format=(
            "Tables Markdown (ID, Scenario, Steps, Expected Result, Priority). "
            "Matrice couverture/risques et critères pass/fail explicites. "
            "Cas exécutables plutôt que conseils génériques."
        ),
        export_title="Tests & QA",
    ),
    SdlcPhaseCatalogEntry(
        id=7,
        name="Recette (UAT)",
        key_question="Le client et les utilisateurs finaux valident-ils le produit ?",
        objective=(
            "Préparer la validation métier et le sign-off utilisateur avec scénarios "
            "UAT et critères d'entrée/sortie."
        ),
        expected_deliverables=(
            "Procès-Verbal de Recette (PVR) signé",
            "Cahier & fiches de tests UAT",
            "Liste des anomalies résiduelles",
            "Plan de déploiement validé",
        ),
        default_role="UAT Lead / Business Acceptance Manager",
        domain_expertise="user acceptance testing, sign-off governance, and residual risk tracking",
        output_format=(
            "Markdown avec checklists (- [ ]) et scénarios Given/When/Then. "
            "Entry criteria, exit criteria, anomalies résiduelles, plan de déploiement."
        ),
        export_title="Recette",
    ),
    SdlcPhaseCatalogEntry(
        id=8,
        name="DevOps / CI-CD",
        key_question="Comment automatiser et fiabiliser les déploiements ?",
        objective=(
            "Automatiser build/deploy/rollback et fiabiliser les environnements "
            "via CI/CD et IaC."
        ),
        expected_deliverables=(
            "Pipeline CI/CD opérationnel",
            "Scripts IaC (Terraform/Ansible)",
            "Configuration des environnements (Docker/K8s)",
            "Runbooks opérationnels",
        ),
        default_role="Senior DevOps / Platform Engineer",
        domain_expertise="CI/CD, containers, Kubernetes, and infrastructure as code",
        output_format=(
            "Snippets fenced complets (YAML, Dockerfile, Terraform ou shell). "
            "Runbook Markdown: build, deploy, rollback, health verification. "
            "Aucun stub TODO dans les configs."
        ),
        export_title="DevOps / CI-CD",
    ),
    SdlcPhaseCatalogEntry(
        id=9,
        name="Mise en prod & Maintenance",
        key_question="Comment maintenir le logiciel stable, sécurisé et évolutif ?",
        objective=(
            "Assurer la mise en production, l'observabilité et la maintenance "
            "continue post-release."
        ),
        expected_deliverables=(
            "Application déployée en production",
            "Dashboards de monitoring/observabilité",
            "Post-mortems d'incidents",
            "Rapports de maintenance",
        ),
        default_role="Site Reliability Engineer / Release Manager",
        domain_expertise="release management, observability, and incident response",
        output_format=(
            "Markdown avec: Release Checklist, Rollback Plan, Monitoring & Alerts, "
            "Communication Plan. Checklists (- [ ]) pour les go-live gates."
        ),
        export_title="Mise en production",
    ),
)

SDLC_CATALOG: Mapping[int, SdlcPhaseCatalogEntry] = MappingProxyType(
    {entry.id: entry for entry in _PHASES}
)


def get_phase(phase: int) -> SdlcPhaseCatalogEntry | None:
    try:
        key = int(phase)
    except (TypeError, ValueError):
        return None
    return SDLC_CATALOG.get(key)


def phase_export_title(phase: int) -> str:
    entry = get_phase(phase)
    if entry is None:
        return f"Phase {phase}"
    return entry.export_title


def phase_expected_deliverables(phase: int) -> list[str]:
    entry = get_phase(phase)
    if entry is None:
        return []
    return list(entry.expected_deliverables)
