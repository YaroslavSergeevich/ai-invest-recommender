-- users_db: companies table (from target_companies.csv)
CREATE TABLE companies (
    synthetic_u       TEXT PRIMARY KEY,
    org_type          TEXT,
    okfs_name         TEXT,
    company_age_years_gradation TEXT,
    eco_mark_label    TEXT,
    mainokved_code    TEXT,
    mainokved_name    TEXT,
    amount_workers_fns_gradation TEXT,
    cl_type           TEXT,
    cl_product_rko_mark BOOLEAN,
    cl_product_gar_mark BOOLEAN,
    cl_product_loa_mark BOOLEAN,
    cl_product_lea_mark BOOLEAN,
    cl_product_dep_mark BOOLEAN,
    cl_product_zpp_mark BOOLEAN,
    fts_country_name  TEXT,
    factoring_mark    BOOLEAN,
    revenue_company   BIGINT,
    group_id          TEXT,
    city              TEXT,
    region            TEXT,
    business_size_fns TEXT,
    additional_sectors JSONB  -- array of 2-digit OKVED codes
);

-- users_db: groups table (from target_groups.csv)
CREATE TABLE groups (
    group_id              TEXT PRIMARY KEY,
    target_company_ids    JSONB,      -- array of synthetic_u
    revenue_sum           BIGINT,
    business_size_bank    TEXT,
    own_sectors           JSONB,      -- array of 2-digit OKVED codes
    mainokved_codes       JSONB,
    regions               JSONB,
    cities                JSONB,
    fts_countries         JSONB,
    ownership_forms       JSONB,
    development_stages    JSONB,
    mainokved_names       JSONB,      -- object {code: [names]}
    additional_sectors    JSONB
);

-- Indexes for common lookups
CREATE INDEX idx_companies_group_id ON companies(group_id);
CREATE INDEX idx_companies_mainokved ON companies(mainokved_code);
CREATE INDEX idx_companies_region ON companies(region);
CREATE INDEX idx_groups_business_size ON groups(business_size_bank);