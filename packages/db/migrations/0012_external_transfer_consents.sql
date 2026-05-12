CREATE TABLE IF NOT EXISTS external_transfer_consents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  book_id TEXT,
  task TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  scope TEXT NOT NULL,
  source_lang TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_external_transfer_consents_project
  ON external_transfer_consents(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_transfer_consents_book
  ON external_transfer_consents(book_id, created_at DESC);
