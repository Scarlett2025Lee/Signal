ALTER TABLE companies ADD COLUMN x_url TEXT;
ALTER TABLE companies ADD COLUMN linkedin_url TEXT;
ALTER TABLE companies ADD COLUMN public_email TEXT;
ALTER TABLE companies ADD COLUMN public_phone TEXT;
ALTER TABLE companies ADD COLUMN recruiting_email TEXT;
ALTER TABLE companies ADD COLUMN recruiting_phone TEXT;
ALTER TABLE companies ADD COLUMN offices TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN info_source_url TEXT;
ALTER TABLE companies ADD COLUMN info_checked_on TEXT;
ALTER TABLE companies ADD COLUMN hiring_status TEXT NOT NULL DEFAULT 'unknown' CHECK (hiring_status IN ('unknown','roles_found','no_relevant_roles'));
ALTER TABLE companies ADD COLUMN hiring_source_url TEXT;
ALTER TABLE companies ADD COLUMN hiring_checked_on TEXT;
ALTER TABLE contacts ADD COLUMN phone TEXT;
ALTER TABLE contacts ADD COLUMN is_founder INTEGER NOT NULL DEFAULT 0 CHECK (is_founder IN (0,1));
CREATE TABLE company_jobs (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    track TEXT NOT NULL CHECK (track IN ('PM','GTM','Data')),
    url TEXT NOT NULL,
    evidence TEXT NOT NULL,
    checked_on TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    UNIQUE(company_id,url,title)
);
