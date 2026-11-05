CREATE TABLE IF NOT EXISTS prism_version_trash (
 version_id TEXT PRIMARY KEY NOT NULL,
 deleted_at TEXT NOT NULL,
 purge_started_at TEXT,
 cursor INTEGER NOT NULL DEFAULT 0
);
