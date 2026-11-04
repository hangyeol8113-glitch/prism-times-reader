ALTER TABLE prism_editions ADD purge_started_at TEXT;
ALTER TABLE prism_editions ADD purged_at TEXT;
CREATE TABLE prism_purge_jobs (
 edition_id TEXT PRIMARY KEY NOT NULL,
 cursor INTEGER NOT NULL DEFAULT 0
);
