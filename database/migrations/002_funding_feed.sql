CREATE TABLE funding_reports (
    id INTEGER PRIMARY KEY,
    window_start TEXT NOT NULL,
    window_end TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('complete', 'partial', 'failed')),
    sources_json TEXT NOT NULL,
    country_code TEXT NOT NULL DEFAULT 'US',
    UNIQUE(window_start, window_end)
);
CREATE TABLE funding_articles (
    id INTEGER PRIMARY KEY,
    source_url TEXT NOT NULL UNIQUE,
    source_name TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    published_at TEXT NOT NULL,
    company_name TEXT NOT NULL,
    company_key TEXT NOT NULL,
    sector TEXT CHECK (sector IN ('AI','Fintech','AI + Fintech') OR sector IS NULL),
    country_code TEXT,
    round_type TEXT CHECK (round_type IN ('pre_seed','seed','series_a','series_b') OR round_type IS NULL),
    amount_text TEXT NOT NULL DEFAULT '',
    announced_on TEXT,
    extraction_notes TEXT NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
    company_id INTEGER REFERENCES companies(id),
    funding_round_id INTEGER REFERENCES funding_rounds(id),
    reviewed_at TEXT
);
CREATE INDEX funding_articles_company_key_idx ON funding_articles(company_key);
CREATE TABLE report_articles (
    report_id INTEGER NOT NULL REFERENCES funding_reports(id) ON DELETE CASCADE,
    article_id INTEGER NOT NULL REFERENCES funding_articles(id) ON DELETE CASCADE,
    PRIMARY KEY(report_id,article_id)
);
CREATE TABLE funding_schedule (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    last_attempt_at TEXT,
    last_success_at TEXT
);
INSERT INTO funding_schedule(id) VALUES(1);
