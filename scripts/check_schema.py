"""Exercise the production SQL migration against an isolated SQLite database.

Python is a validation tool here, not an application runtime dependency.
"""
from pathlib import Path
import sqlite3
import tempfile
import unittest

SCHEMA = (Path(__file__).resolve().parents[1] / 'database/migrations/001_initial.sql').read_text()


class SchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys = ON')
        self.db.executescript(SCHEMA)
        self.db.execute("INSERT INTO companies (id, name) VALUES (1, 'Example'), (2, 'Other')")
        self.db.execute("INSERT INTO contacts (id, company_id, name) VALUES (1, 1, 'Founder')")
        self.db.execute("INSERT INTO outreach (id, company_id, contact_id) VALUES (1, 1, 1)")

    def tearDown(self):
        self.db.close()

    def test_all_feature_tables_exist(self):
        tables = {row[0] for row in self.db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        self.assertEqual(tables, {'companies', 'funding_rounds', 'contacts', 'outreach', 'email_drafts', 'resumes', 'projects', 'matches', 'follow_ups'})
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_invalid_status_and_cross_company_contact_are_rejected(self):
        for sql in ["UPDATE outreach SET status = 'invented' WHERE id = 1", "INSERT INTO outreach (company_id, contact_id) VALUES (2, 1)", "INSERT INTO contacts (company_id, name) VALUES (99, 'Orphan')"]:
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(sql)

    def test_funding_source_deduplication_and_currency(self):
        sql = "INSERT INTO funding_rounds (company_id, round_type, announced_on, source_url) VALUES (1, 'seed', '2026-10-30', 'https://example.com/round')"
        self.db.execute(sql)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(sql)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('UPDATE funding_rounds SET amount_minor = 100')
        self.db.execute("UPDATE funding_rounds SET amount_minor = 100, currency = 'USD'")

    def test_match_requires_one_asset_and_explanation(self):
        self.db.execute("INSERT INTO resumes (id, label) VALUES (1, 'Product')")
        self.db.execute("INSERT INTO projects (id, name) VALUES (1, 'Payments portfolio')")
        for sql in ["INSERT INTO matches (outreach_id, rationale) VALUES (1, 'Fit')", "INSERT INTO matches (outreach_id, resume_id, project_id, rationale) VALUES (1, 1, 1, 'Fit')", "INSERT INTO matches (outreach_id, project_id, rationale, score) VALUES (1, 1, 'Fit', 101)"]:
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(sql)
        self.db.execute("INSERT INTO matches (outreach_id, project_id, rationale, score) VALUES (1, 1, 'Payment API experience', 85)")

    def test_due_follow_ups_and_completion(self):
        self.db.execute("INSERT INTO follow_ups (outreach_id, due_at) VALUES (1, '2000-01-01T00:00:00Z'), (1, '2999-01-01T00:00:00Z')")
        self.assertEqual(self.db.execute("SELECT count(*) FROM follow_ups WHERE status = 'pending' AND julianday(due_at) <= julianday('now')").fetchone()[0], 1)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE follow_ups SET status = 'completed' WHERE id = 1")
        self.db.execute("UPDATE follow_ups SET status = 'completed', completed_at = '2026-10-31T12:00:00Z' WHERE id = 1")

    def test_outreach_history_is_protected_and_child_records_cascade(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('DELETE FROM companies WHERE id = 1')
        self.db.execute("INSERT INTO email_drafts (outreach_id, subject) VALUES (1, 'Hello')")
        self.db.execute("INSERT INTO follow_ups (outreach_id, due_at) VALUES (1, '2026-11-01T00:00:00Z')")
        self.db.execute('DELETE FROM outreach WHERE id = 1')
        for table in ['email_drafts', 'follow_ups']:
            self.assertEqual(self.db.execute(f'SELECT count(*) FROM {table}').fetchone()[0], 0)

    def test_database_survives_reopening(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'signal.sqlite3'
            with sqlite3.connect(path) as db:
                db.executescript(SCHEMA)
                db.execute("INSERT INTO companies (name) VALUES ('Retained')")
                db.execute('PRAGMA user_version = 1')
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute('SELECT name FROM companies').fetchone()[0], 'Retained')
                self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
