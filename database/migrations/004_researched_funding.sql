ALTER TABLE funding_articles ADD COLUMN eligibility TEXT NOT NULL DEFAULT 'research' CHECK(eligibility IN ('included','research','excluded'));
ALTER TABLE funding_articles ADD COLUMN hq_location TEXT NOT NULL DEFAULT '';
ALTER TABLE funding_articles ADD COLUMN hq_evidence_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE funding_articles ADD COLUMN research_error TEXT NOT NULL DEFAULT '';
ALTER TABLE funding_articles ADD COLUMN researched_at TEXT;
ALTER TABLE funding_articles ADD COLUMN company_website TEXT NOT NULL DEFAULT '';
ALTER TABLE funding_articles ADD COLUMN classification_version INTEGER NOT NULL DEFAULT 0;
-- Old confirmed records are retained. Unreviewed old candidates are hidden until researched.
UPDATE funding_articles SET eligibility='included' WHERE review_status='approved';
UPDATE funding_schedule SET last_success_at=NULL,last_attempt_at=NULL WHERE id=1;
