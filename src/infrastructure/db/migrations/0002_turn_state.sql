-- v2: turn state, request idempotency, workspace per turn, and media blobs

ALTER TABLE messages ADD COLUMN state TEXT CHECK (state IS NULL OR (role = 'assistant' AND state IN ('running','completed','failed','interrupted')));
ALTER TABLE messages ADD COLUMN client_request_id TEXT CHECK (client_request_id IS NULL OR role = 'assistant');
ALTER TABLE messages ADD COLUMN error_message TEXT CHECK (error_message IS NULL OR (role = 'assistant' AND length(error_message) <= 500));
ALTER TABLE messages ADD COLUMN workspace_path TEXT;

CREATE UNIQUE INDEX messages_one_running_per_session
  ON messages(session_id)
  WHERE state = 'running';

CREATE UNIQUE INDEX messages_client_request_unique
  ON messages(session_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE TABLE media_blob (
  sha256     TEXT NOT NULL PRIMARY KEY,
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL CHECK (bytes >= 0),
  width      INTEGER,
  height     INTEGER,
  data       BLOB NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

ALTER TABLE artifacts ADD COLUMN sha256 TEXT;
