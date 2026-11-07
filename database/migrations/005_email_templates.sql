-- Cold-email templates edited in the Cold Email Generator. Additive only; no existing data changes.
-- Placeholders such as {{company}} are filled from company, funding, contact and outreach data.
CREATE TABLE email_templates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO email_templates (name, subject, body) VALUES (
    'Funding congrats — internship',
    'Congrats on the funding — interested in contributing to {{company}}',
    'Hi {{first_name}},

I came across {{company}}''s recent {{funding}} announcement and was excited by what you''re building: {{what_they_do}}

{{hiring_line}} I''d be very interested in contributing across {{tracks}}.

[Your background in one or two sentences — for example, your previous role and what you are studying or building now.]

What I find particularly interesting about {{company}} is [the specific problem they are solving]. [One sentence on why your background fits that problem.]

If there''s room for an intern to help with market research, customer analysis, GTM experiments, product feedback or other zero-to-one projects, I''d love to contribute.

I''ve attached my resume and would be happy to chat.

Best,
[Your name]'
);
