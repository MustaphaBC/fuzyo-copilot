-- Fuzyo DAT schema — run in the Supabase SQL Editor.
-- Enable the `vector` extension on the project if prompted.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    tech_stack JSONB DEFAULT '[]'::jsonb,
    custom_instructions TEXT,
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
