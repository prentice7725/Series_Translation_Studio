CREATE TABLE IF NOT EXISTS glossary_terms (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_term TEXT NOT NULL,
  canonical_ko TEXT NOT NULL,
  category TEXT NOT NULL,
  aliases TEXT,
  forbidden_targets TEXT,
  context_rules TEXT,
  notes TEXT,
  confidence TEXT NOT NULL,
  do_not_translate INTEGER NOT NULL DEFAULT 0,
  needs_review INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_glossary_project ON glossary_terms(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_glossary_project_source
  ON glossary_terms(project_id, source_term);
