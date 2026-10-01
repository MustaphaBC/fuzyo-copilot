"""In-process registry of background ingest jobs (create-workspace progress)."""

from __future__ import annotations

import time
from collections import OrderedDict
from dataclasses import asdict, dataclass, field
from typing import Any, Final
from uuid import UUID, uuid4

_MAX_JOBS: Final[int] = 200

INGEST_STEPS: Final[tuple[str, ...]] = (
    "upload",
    "filter",
    "parse",
    "embed",
    "index",
    "scan",
    "ready",
)


@dataclass
class IngestJob:
    id: str
    workspace_id: str
    owner_id: str
    status: str = "running"  # running | completed | failed
    step: str = "upload"
    total_files: int = 0
    processed_files: int = 0
    files_ingested: int = 0
    chunks_inserted: int = 0
    skipped_ignored: int = 0
    current_file: str | None = None
    error: str | None = None
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data.pop("owner_id", None)
        data["steps"] = list(INGEST_STEPS)
        return data


_jobs: OrderedDict[str, IngestJob] = OrderedDict()


def create_job(workspace_id: UUID | str, owner_id: UUID | str) -> IngestJob:
    job = IngestJob(id=uuid4().hex, workspace_id=str(workspace_id), owner_id=str(owner_id))
    _jobs[job.id] = job
    while len(_jobs) > _MAX_JOBS:
        _jobs.popitem(last=False)
    return job


def get_job(job_id: str, *, owner_id: UUID | str, workspace_id: UUID | str) -> IngestJob | None:
    """Return the job only when it belongs to this owner/workspace (no leak)."""
    job = _jobs.get(job_id)
    if job is None:
        return None
    if job.owner_id != str(owner_id) or job.workspace_id != str(workspace_id):
        return None
    return job


def finish_job(job: IngestJob, *, error: str | None = None) -> None:
    job.status = "failed" if error else "completed"
    job.error = error
    job.step = "ready" if not error else job.step
    job.current_file = None
    job.finished_at = time.time()


def clear_jobs() -> None:
    _jobs.clear()
