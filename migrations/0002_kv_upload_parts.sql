CREATE TABLE prism_upload_parts (
 version_id TEXT NOT NULL,
 part INTEGER NOT NULL,
 size INTEGER NOT NULL,
 status TEXT NOT NULL,
 PRIMARY KEY(version_id,part)
);
