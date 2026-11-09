-- news_db: digests table (from Model A response)
CREATE TABLE digests (
    id              BIGSERIAL PRIMARY KEY,
    industry_id_list JSONB,      -- array of industry codes (e.g., ["46.72.2", "07.29.4"])
    region          TEXT,         -- Russian region code or NULL
    city            TEXT,         -- city name or NULL
    country         TEXT,         -- country name, e.g., "США (US)"
    source          TEXT,         -- source name, e.g., "Внутренняя аналитика" or "РБК"
    text            TEXT,         -- digest content
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX idx_digests_created_at ON digests(created_at DESC);
CREATE INDEX idx_digests_source ON digests(source);
CREATE INDEX idx_digests_region ON digests(region);
CREATE INDEX idx_digests_country ON digests(country);
CREATE INDEX idx_digests_industry ON digests USING GIN(industry_id_list);