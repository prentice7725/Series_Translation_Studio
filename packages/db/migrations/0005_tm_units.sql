CREATE TABLE IF NOT EXISTS tm_units (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  book_id TEXT,
  source_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  grade TEXT NOT NULL,
  origin TEXT NOT NULL,
  confidence REAL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(book_id) REFERENCES books(id)
);

CREATE INDEX IF NOT EXISTS idx_tm_project ON tm_units(project_id);
CREATE INDEX IF NOT EXISTS idx_tm_project_hash ON tm_units(project_id, source_hash);
CREATE INDEX IF NOT EXISTS idx_tm_project_grade ON tm_units(project_id, grade);
