# syntax=docker/dockerfile:1
# Fuzyo Copilot API — multi-stage, non-root, WeasyPrint-ready.

FROM python:3.12-slim-bookworm AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        libffi-dev \
        libjpeg62-turbo-dev \
        zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY backend/requirements.txt /build/requirements.txt
RUN python -m venv /venv \
    && /venv/bin/pip install --upgrade pip \
    && /venv/bin/pip install -r /build/requirements.txt


FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PATH="/venv/bin:${PATH}" \
    LOCAL_WORKSPACE_STORAGE_PATH=/data/workspaces

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libcairo2 \
        libffi8 \
        libgdk-pixbuf-2.0-0 \
        libglib2.0-0 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libpangoft2-1.0-0 \
        shared-mime-info \
        fonts-dejavu-core \
        curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /venv /venv

RUN groupadd --gid 10001 fuzyo \
    && useradd --uid 10001 --gid fuzyo --create-home --shell /usr/sbin/nologin fuzyo \
    && mkdir -p /app /data/workspaces \
    && chown -R fuzyo:fuzyo /app /data/workspaces /venv

WORKDIR /app
COPY --chown=fuzyo:fuzyo backend/ /app/backend/

USER fuzyo
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -sf http://127.0.0.1:8000/health || exit 1

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
