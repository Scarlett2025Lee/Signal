-- Applied once inside a transaction by the Node.js migration runner.
-- Times are UTC ISO 8601 strings; amounts are integer minor currency units.
CREATE TABLE companies (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    website TEXT,
    domain TEXT COLLATE NOCASE UNIQUE,
    sector TEXT,
    headquarters TEXT,
    country_code TEXT CHECK (country_code IS NULL OR length(country_code) = 2),
    employee_count INTEGER CHECK (employee_count IS NULL OR employee_count >= 0),
    product_summary TEXT NOT NULL DEFAULT '',
    hiring_notes TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE funding_rounds (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    round_type TEXT NOT NULL CHECK (round_type IN ('pre_seed', 'seed', 'series_a', 'series_b', 'other')),
    amount_minor INTEGER CHECK (amount_minor IS NULL OR amount_minor >= 0),
    currency TEXT CHECK (currency IS NULL OR length(currency) = 3),
    announced_on TEXT NOT NULL CHECK (date(announced_on) IS NOT NULL AND announced_on = date(announced_on)),
    investors TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL CHECK (length(trim(source_url)) > 0),
    verified_at TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (company_id, round_type, announced_on, source_url),
    CHECK (amount_minor IS NULL OR currency IS NOT NULL)
);
CREATE INDEX funding_rounds_date_idx ON funding_rounds(announced_on DESC);
CREATE INDEX funding_rounds_company_idx ON funding_rounds(company_id);

CREATE TABLE contacts (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    title TEXT,
    email TEXT COLLATE NOCASE,
    profile_url TEXT,
    source_url TEXT,
    verified_at TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (company_id, id),
    UNIQUE (company_id, email)
);

CREATE TABLE outreach (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    contact_id INTEGER,
    role_title TEXT,
    role_url TEXT,
    status TEXT NOT NULL DEFAULT 'research' CHECK (status IN ('research', 'ready', 'contacted', 'in_conversation', 'interviewing', 'offer', 'closed')),
    last_contacted_at TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (company_id, contact_id) REFERENCES contacts(company_id, id) ON DELETE RESTRICT
);
CREATE INDEX outreach_company_idx ON outreach(company_id);
CREATE INDEX outreach_contact_idx ON outreach(contact_id);
CREATE INDEX outreach_status_idx ON outreach(status);

CREATE TABLE email_drafts (
    id INTEGER PRIMARY KEY,
    outreach_id INTEGER NOT NULL REFERENCES outreach(id) ON DELETE CASCADE,
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'sent_manually')),
    generation_context TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX email_drafts_outreach_idx ON email_drafts(outreach_id);

CREATE TABLE resumes (
    id INTEGER PRIMARY KEY,
    label TEXT NOT NULL CHECK (length(trim(label)) > 0),
    file_path TEXT,
    content_text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    summary TEXT NOT NULL DEFAULT '',
    skills TEXT NOT NULL DEFAULT '',
    project_url TEXT,
    evidence_text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE matches (
    id INTEGER PRIMARY KEY,
    outreach_id INTEGER NOT NULL REFERENCES outreach(id) ON DELETE CASCADE,
    resume_id INTEGER REFERENCES resumes(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    score REAL CHECK (score IS NULL OR score BETWEEN 0 AND 100),
    rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK ((resume_id IS NOT NULL) + (project_id IS NOT NULL) = 1)
);
CREATE UNIQUE INDEX matches_resume_idx ON matches(outreach_id, resume_id) WHERE resume_id IS NOT NULL;
CREATE UNIQUE INDEX matches_project_idx ON matches(outreach_id, project_id) WHERE project_id IS NOT NULL;
CREATE INDEX matches_resume_fk_idx ON matches(resume_id);
CREATE INDEX matches_project_fk_idx ON matches(project_id);

CREATE TABLE follow_ups (
    id INTEGER PRIMARY KEY,
    outreach_id INTEGER NOT NULL REFERENCES outreach(id) ON DELETE CASCADE,
    due_at TEXT NOT NULL CHECK (julianday(due_at) IS NOT NULL),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'dismissed')),
    completed_at TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK ((status = 'completed' AND completed_at IS NOT NULL) OR (status != 'completed' AND completed_at IS NULL))
);
CREATE INDEX follow_ups_due_idx ON follow_ups(status, due_at);
CREATE INDEX follow_ups_outreach_idx ON follow_ups(outreach_id);
