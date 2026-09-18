"""Build downloadable phase deliverables (docx, zip, raw, md)."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path
from typing import Any

from docx import Document
from docx.shared import Pt

from backend.app.prompts.sdlc_catalog import phase_export_title
from backend.app.services.artifact_router import phase_dir

_DOC_PHASES = frozenset({1, 2, 3, 4, 7, 8, 9})
_ZIP_PHASES = frozenset({5, 6})


def default_format_for_phase(phase: int) -> str:
    key = int(phase)
    if key in _ZIP_PHASES:
        return "zip"
    return "docx"


def phase_folder_relative(phase: int) -> str:
    return phase_dir(phase)


def _phase_entry(audit_report: dict[str, Any] | None, phase: int) -> dict[str, Any]:
    phases = (audit_report or {}).get("phases") or []
    for item in phases:
        try:
            if int(item.get("id")) == int(phase):
                return item if isinstance(item, dict) else {}
        except (TypeError, ValueError):
            continue
    return {}


def _collect_markdown_files(root: Path, relative_dir: str) -> list[tuple[str, str]]:
    base = root / relative_dir
    if not base.is_dir():
        return []
    out: list[tuple[str, str]] = []
    for path in sorted(base.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".md", ".markdown", ".txt", ".mermaid"}:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        rel = path.relative_to(root).as_posix()
        out.append((rel, text))
    return out


def build_phase_docx(
    workspace_name: str,
    phase: int,
    audit_report: dict[str, Any] | None = None,
    *,
    root: Path | None = None,
) -> bytes:
    """Build a Word document for a docs-oriented SDLC phase."""
    doc = Document()
    title = phase_export_title(phase)
    heading = doc.add_heading(f"{workspace_name} — {title}", level=0)
    for run in heading.runs:
        run.font.size = Pt(18)

    entry = _phase_entry(audit_report, phase)
    doc.add_heading("Phase summary", level=1)
    doc.add_paragraph(f"Phase ID: {phase}")
    doc.add_paragraph(f"Name: {entry.get('name') or title}")
    doc.add_paragraph(f"Status: {entry.get('status') or 'pending'}")
    doc.add_paragraph(f"Progress: {entry.get('pct', 0)}%")

    deliverables = entry.get("deliverables") or []
    expected = entry.get("expected_deliverables") or []
    doc.add_heading("Deliverables", level=1)
    if deliverables:
        for item in deliverables:
            doc.add_paragraph(str(item), style="List Bullet")
    else:
        doc.add_paragraph("No deliverables recorded in the audit report yet.")

    if expected:
        doc.add_heading("Expected deliverables (FUZYO catalog)", level=1)
        for item in expected:
            doc.add_paragraph(str(item), style="List Bullet")

    scores = (audit_report or {}).get("scores") or {}
    if scores:
        doc.add_heading("Audit scores", level=1)
        table = doc.add_table(rows=1, cols=2)
        hdr = table.rows[0].cells
        hdr[0].text = "Metric"
        hdr[1].text = "Score"
        for key, value in scores.items():
            row = table.add_row().cells
            row[0].text = str(key).replace("_", " ").title()
            row[1].text = f"{value}"

    if root is not None:
        files = _collect_markdown_files(root, phase_folder_relative(phase))
        if files:
            doc.add_heading("Local phase content", level=1)
            for rel, text in files[:12]:
                doc.add_heading(rel, level=2)
                # Cap extremely long files for Word stability
                snippet = text if len(text) <= 12000 else text[:12000] + "\n\n[…truncated…]"
                for block in snippet.split("\n\n"):
                    para = doc.add_paragraph(block.strip())
                    if not para.text:
                        continue

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def build_phase_zip(root: Path, phase: int) -> bytes:
    """Zip the phase folder (src / tests / docs phase dir)."""
    relative = phase_folder_relative(phase)
    folder = root / relative
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        if folder.is_dir():
            for path in folder.rglob("*"):
                if not path.is_file():
                    continue
                if ".fuzyo" in path.parts:
                    continue
                arcname = path.relative_to(root).as_posix()
                archive.write(path, arcname)
        else:
            archive.writestr(
                f"{relative.rstrip('/')}/README.txt",
                f"Phase {phase} folder is empty or missing.\n",
            )
    return buffer.getvalue()


def build_phase_markdown(
    workspace_name: str,
    phase: int,
    audit_report: dict[str, Any] | None = None,
    *,
    root: Path | None = None,
) -> bytes:
    title = phase_export_title(phase)
    entry = _phase_entry(audit_report, phase)
    lines = [
        f"# {workspace_name} — {title}",
        "",
        f"- Phase: {phase}",
        f"- Status: {entry.get('status') or 'pending'}",
        f"- Progress: {entry.get('pct', 0)}%",
        "",
        "## Deliverables",
        "",
    ]
    deliverables = entry.get("deliverables") or []
    if deliverables:
        for item in deliverables:
            lines.append(f"- {item}")
    else:
        lines.append("_No deliverables detected yet._")
    lines.append("")

    expected = entry.get("expected_deliverables") or []
    if expected:
        lines.extend(["## Expected deliverables (FUZYO catalog)", ""])
        for item in expected:
            lines.append(f"- {item}")
        lines.append("")

    if root is not None:
        files = _collect_markdown_files(root, phase_folder_relative(phase))
        for rel, text in files:
            lines.extend(["", f"## {rel}", "", text])

    return "\n".join(lines).encode("utf-8")


def build_phase_raw_file(root: Path, phase: int) -> tuple[bytes, str]:
    """Return first matching artifact (prefer mermaid for architecture) or concatenated md."""
    relative = phase_folder_relative(phase)
    folder = root / relative
    if folder.is_dir():
        if int(phase) == 3:
            for path in sorted(folder.rglob("*.mermaid")):
                if path.is_file():
                    return path.read_bytes(), path.name
        preferred = (".md", ".markdown", ".txt", ".mermaid", ".py", ".ts", ".js")
        for suffix in preferred:
            matches = sorted(folder.rglob(f"*{suffix}"))
            for path in matches:
                if path.is_file():
                    return path.read_bytes(), path.name
        for path in sorted(folder.rglob("*")):
            if path.is_file():
                return path.read_bytes(), path.name
    # Fallback empty marker
    return (
        f"# Phase {phase}\n\nNo local artifacts found under `{relative}`.\n".encode("utf-8"),
        f"phase_{phase}_empty.md",
    )


def _html_escape(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _md_to_html(text: str) -> str:
    try:
        import markdown as md

        return md.markdown(text or "", extensions=["tables", "fenced_code"])
    except Exception:  # noqa: BLE001
        return f"<pre>{_html_escape(text or '')}</pre>"


def _render_pdf_from_html(html_string: str) -> bytes:
    """Prefer WeasyPrint; fall back to xhtml2pdf on Windows/missing GTK."""
    try:
        from weasyprint import HTML

        return HTML(string=html_string).write_pdf()
    except Exception:  # noqa: BLE001
        from xhtml2pdf import pisa

        buffer = io.BytesIO()
        result = pisa.CreatePDF(html_string, dest=buffer)
        if result.err:
            raise RuntimeError("PDF generation failed (WeasyPrint and xhtml2pdf)") from None
        return buffer.getvalue()


def build_phase_pdf(
    workspace_name: str,
    phase: int,
    audit_report: dict[str, Any] | None = None,
    *,
    root: Path | None = None,
) -> bytes:
    """Build a styled PDF from the same phase data as the DOCX builder."""
    title = phase_export_title(phase)
    entry = _phase_entry(audit_report, phase)
    deliverables = entry.get("deliverables") or []
    expected = entry.get("expected_deliverables") or []
    scores = (audit_report or {}).get("scores") or {}

    def bullets(items: list[Any], empty: str) -> str:
        if not items:
            return f"<p>{_html_escape(empty)}</p>"
        lis = "".join(f"<li>{_html_escape(item)}</li>" for item in items)
        return f"<ul>{lis}</ul>"

    score_rows = ""
    if scores:
        score_rows = "".join(
            "<tr>"
            f"<td>{_html_escape(str(key).replace('_', ' ').title())}</td>"
            f"<td>{_html_escape(str(value))}</td>"
            "</tr>"
            for key, value in scores.items()
        )
        score_section = f"""
        <h2>Audit scores</h2>
        <table>
          <thead><tr><th>Metric</th><th>Score</th></tr></thead>
          <tbody>{score_rows}</tbody>
        </table>
        """
    else:
        score_section = ""

    local_sections = ""
    if root is not None:
        files = _collect_markdown_files(root, phase_folder_relative(phase))
        for rel, text in files[:12]:
            snippet = text if len(text) <= 12000 else text[:12000] + "\n\n[…truncated…]"
            local_sections += f"<h2>{_html_escape(rel)}</h2>{_md_to_html(snippet)}"

    html_string = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    @page {{ margin: 2cm; }}
    body {{ font-family: system-ui, -apple-system, Segoe UI, sans-serif; color: #111; font-size: 11pt; }}
    .header {{ background: #1a1a2e; color: #fff; padding: 18px 20px; margin: -10px -10px 24px -10px; }}
    .header h1 {{ margin: 0; font-size: 18pt; }}
    .header p {{ margin: 6px 0 0; opacity: 0.85; font-size: 10pt; }}
    h1, h2 {{ color: #1a1a2e; }}
    table {{ width: 100%; border-collapse: collapse; margin: 12px 0; }}
    th {{ background: #0f3460; color: #fff; text-align: left; padding: 8px; }}
    td {{ border: 1px solid #ddd; padding: 8px; }}
    ul {{ padding-left: 1.2em; }}
  </style>
</head>
<body>
  <div class="header">
    <h1>Fuzyo · {_html_escape(workspace_name)}</h1>
    <p>Phase {int(phase)} — {_html_escape(title)}</p>
  </div>
  <h2>Phase summary</h2>
  <p>Phase ID: {int(phase)}</p>
  <p>Name: {_html_escape(entry.get("name") or title)}</p>
  <p>Status: {_html_escape(entry.get("status") or "pending")}</p>
  <p>Progress: {_html_escape(str(entry.get("pct", 0)))}%</p>
  <h2>Deliverables</h2>
  {bullets(list(deliverables), "No deliverables recorded in the audit report yet.")}
  <h2>Expected deliverables (FUZYO catalog)</h2>
  {bullets(list(expected), "No catalog deliverables for this phase.")}
  {score_section}
  {local_sections}
</body>
</html>
"""
    return _render_pdf_from_html(html_string)


def build_uat_sheet_markdown(
    *,
    project_name: str,
    phase: int,
    phase_title: str,
    deliverables: list[str],
    validator_name: str,
    signed_at_utc: str,
    content_sha256: str,
    notes: str = "",
) -> str:
    """Generate a UAT checklist sheet (Markdown) for the signed-off phase."""
    rows = "\n".join(
        f"| UAT-{index:02d} | {_md_cell(item)} | Given/When/Then | - [ ] Pass |  |"
        for index, item in enumerate(deliverables, start=1)
    ) or "| — | Aucun livrable | — | - [ ] | |"
    notes_block = (notes or "").strip() or "_Aucune note._"
    return (
        f"# Fiche de tests UAT — {project_name}\n\n"
        f"- **Phase :** {int(phase)} — {phase_title}\n"
        f"- **Validateur :** {validator_name}\n"
        f"- **Horodatage UTC :** {signed_at_utc}\n"
        f"- **Empreinte SHA-256 (contenu PVR) :** `{content_sha256}`\n\n"
        "## Scénarios\n\n"
        "| ID | Livrable / scénario | Steps | Résultat | Commentaire |\n"
        "| --- | --- | --- | --- | --- |\n"
        f"{rows}\n\n"
        "## Critères d'entrée\n\n"
        "- [ ] Environnement de recette disponible\n"
        "- [ ] Jeu de données de test chargé\n"
        "- [ ] Livrables de la phase transmis au métier\n\n"
        "## Critères de sortie\n\n"
        "- [ ] Tous les scénarios critiques Pass\n"
        "- [ ] Anomalies bloquantes corrigées ou acceptées\n"
        "- [ ] PVR signé (hash ci-dessus)\n\n"
        f"## Notes\n\n{notes_block}\n"
    )


def _md_cell(text: str) -> str:
    return str(text or "").replace("|", "\\|").replace("\n", " ").strip()


def build_pvr_pdf(
    *,
    project_name: str,
    phase: int,
    phase_title: str,
    deliverables: list[str],
    validator_name: str,
    signed_at_utc: str,
    content_sha256: str,
    notes: str = "",
    accepted: bool = True,
) -> bytes:
    """Build the official Procès-Verbal de Recette (PVR) PDF."""
    decision = "ACCEPTÉ" if accepted else "REFUSÉ"
    bullets = "".join(f"<li>{_html_escape(item)}</li>" for item in deliverables)
    if not bullets:
        bullets = "<li>Aucun livrable listé</li>"
    notes_html = _html_escape(notes.strip()) if notes.strip() else "<em>Aucune</em>"

    html_string = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    @page {{ margin: 2cm; }}
    body {{ font-family: system-ui, Segoe UI, sans-serif; color: #111; font-size: 11pt; }}
    .header {{ background: #0f3460; color: #fff; padding: 18px 20px; margin: -10px -10px 24px -10px; }}
    .header h1 {{ margin: 0; font-size: 18pt; }}
    .meta {{ margin: 8px 0; }}
    .hash {{ font-family: ui-monospace, Consolas, monospace; font-size: 9pt; word-break: break-all; }}
    .stamp {{ display: inline-block; border: 2px solid #0f3460; padding: 6px 12px; font-weight: 700; }}
    ul {{ padding-left: 1.2em; }}
  </style>
</head>
<body>
  <div class="header">
    <h1>Procès-Verbal de Recette (PVR)</h1>
    <p>Fuzyo Copilot — Phase 07 UAT / Sign-off</p>
  </div>
  <p class="meta"><strong>Projet :</strong> {_html_escape(project_name)}</p>
  <p class="meta"><strong>Phase validée :</strong> {int(phase)} — {_html_escape(phase_title)}</p>
  <p class="meta"><strong>Validateur :</strong> {_html_escape(validator_name)}</p>
  <p class="meta"><strong>Horodatage UTC :</strong> {_html_escape(signed_at_utc)}</p>
  <p class="meta"><strong>Décision :</strong> <span class="stamp">{_html_escape(decision)}</span></p>
  <h2>Liste des livrables</h2>
  <ul>{bullets}</ul>
  <h2>Signature numérique</h2>
  <p>Empreinte SHA-256 du contenu canonique du PVR (JSON normalisé) :</p>
  <p class="hash">{_html_escape(content_sha256)}</p>
  <h2>Notes</h2>
  <p>{notes_html}</p>
</body>
</html>
"""
    return _render_pdf_from_html(html_string)


def download_filename(
    workspace_name: str,
    phase: int,
    fmt: str,
    *,
    raw_name: str | None = None,
) -> str:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in (workspace_name or "workspace"))
    safe = safe.strip("_") or "workspace"
    fmt_norm = (fmt or "").lower()
    if fmt_norm == "docx":
        return f"{safe}_phase_{phase}_CDC.docx" if int(phase) == 1 else f"{safe}_phase_{phase}.docx"
    if fmt_norm == "zip":
        return f"{safe}_phase_{phase}.zip"
    if fmt_norm == "md":
        return f"{safe}_phase_{phase}.md"
    if fmt_norm == "pdf":
        return f"{safe}_phase_{phase}.pdf"
    if fmt_norm == "raw":
        return raw_name or f"{safe}_phase_{phase}.txt"
    return f"{safe}_phase_{phase}.bin"
