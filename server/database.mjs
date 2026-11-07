import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function dataDirectory(override = process.env.SIGNAL_DATA_DIR) {
  if (override !== undefined) {
    if (!isAbsolute(override)) throw new Error('SIGNAL_DATA_DIR must be an absolute path.');
    return override;
  }
  return join(projectRoot, 'data');
}

export function openDatabase(filename = join(dataDirectory(), 'signal.sqlite3')) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const { user_version: version } = db.prepare('PRAGMA user_version').get();
    const migrations = ['001_initial.sql', '002_funding_feed.sql', '003_company_profiles.sql', '004_researched_funding.sql'];
    if (version > migrations.length) throw new Error('Database is newer than this version of Signal. Refusing to downgrade.');
    for (let index = version; index < migrations.length; index++) {
      const migration = readFileSync(new URL(`../database/migrations/${migrations[index]}`, import.meta.url), 'utf8');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(migration);
        db.exec(`PRAGMA user_version = ${index + 1}; COMMIT`);
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function dashboardStats(db) {
  return db.prepare(`SELECT
    (SELECT COUNT(*) FROM companies) AS companies,
    (SELECT COUNT(*) FROM funding_rounds) AS funding_rounds,
    (SELECT COUNT(*) FROM contacts) AS contacts,
    (SELECT COUNT(*) FROM outreach WHERE status IN ('contacted', 'in_conversation', 'interviewing')) AS active_outreach,
    (SELECT COUNT(*) FROM follow_ups WHERE status = 'pending' AND julianday(due_at) <= julianday('now')) AS due_follow_ups
  `).get();
}
