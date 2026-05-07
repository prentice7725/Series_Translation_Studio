CREATE TABLE IF NOT EXISTS translation_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  config_json TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(book_id) REFERENCES books(id)
);

CREATE TABLE IF NOT EXISTS translation_segments (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  source_text TEXT NOT NULL,
  ai_translation TEXT,
  editorial_translation TEXT,
  reviewed_translation TEXT,
  final_translation TEXT,
  status TEXT NOT NULL,
  response_json TEXT,
  editorial_response_json TEXT,
  error_message TEXT,
  source_hash TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  editorial_prompt_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES translation_jobs(id),
  FOREIGN KEY(block_id) REFERENCES text_blocks(id),
  UNIQUE(job_id, block_id, prompt_hash)
);
