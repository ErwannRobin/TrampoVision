-- One row per detected jump. `record` is the whole JumpRecord as the browser computed it (the browser is the only classifier).
-- The auto_* columns copy what is worth filtering on; the review_* columns are a person's correction and survive a re-upload.
CREATE TABLE IF NOT EXISTS jumps (
  id                TEXT PRIMARY KEY,          -- `${videoId}:${jumpId}`
  video_id          TEXT NOT NULL,
  jump_id           INTEGER NOT NULL,
  auto_skill        TEXT NOT NULL,             -- legacy skill id, or 'unclassified'
  auto_element_id   TEXT,                      -- element of the FIG table, null when unclassified
  auto_certainty    TEXT,                      -- confident | probable | tentative | null
  auto_confidence   REAL NOT NULL,
  classifier        TEXT NOT NULL,             -- `${id}@${version}`
  fingerprint       TEXT NOT NULL,             -- changes when the measurements or the prediction change
  status            TEXT NOT NULL DEFAULT 'auto', -- auto | confirmed | corrected | unknown | bad-data
  review_element_id TEXT,                      -- the figure a reviewer says it was (confirmed = same as auto)
  review_note       TEXT,
  reviewer          TEXT,
  reviewed_at       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  record            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jumps_status ON jumps (status, auto_confidence);
CREATE INDEX IF NOT EXISTS jumps_video ON jumps (video_id, jump_id);

-- One row per shared clip; the file itself is in R2 (`shares/<id>`). After expires_at the clip is gone: the bucket's lifecycle rule
-- removes the file, and the next upload removes the row.
CREATE TABLE IF NOT EXISTS shares (
  id           TEXT PRIMARY KEY,   -- 22 random base64url characters: the link
  size         INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  delete_hash  TEXT NOT NULL       -- SHA-256 of the key the uploader received to remove it
);
CREATE INDEX IF NOT EXISTS shares_created ON shares (created_at);
