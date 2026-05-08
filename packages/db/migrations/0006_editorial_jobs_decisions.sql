CREATE TABLE IF NOT EXISTS editorial_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  translation_job_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  config_json TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(book_id) REFERENCES books(id),
  FOREIGN KEY(translation_job_id) REFERENCES translation_jobs(id)
);

CREATE TABLE IF NOT EXISTS editorial_decisions (
  id TEXT PRIMARY KEY,
  editorial_job_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  source_text TEXT NOT NULL,
  ai_translation TEXT NOT NULL,
  reference_translation TEXT,
  editorial_translation TEXT,
  decision TEXT NOT NULL,
  tm_grade TEXT NOT NULL,
  confidence REAL NOT NULL,
  rationale TEXT,
  qa_flags_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(editorial_job_id) REFERENCES editorial_jobs(id),
  FOREIGN KEY(segment_id) REFERENCES translation_segments(id),
  UNIQUE(editorial_job_id, segment_id)
);

CREATE INDEX IF NOT EXISTS idx_editorial_jobs_book ON editorial_jobs(book_id);
CREATE INDEX IF NOT EXISTS idx_editorial_decisions_job ON editorial_decisions(editorial_job_id);
CREATE INDEX IF NOT EXISTS idx_editorial_decisions_segment ON editorial_decisions(segment_id);
