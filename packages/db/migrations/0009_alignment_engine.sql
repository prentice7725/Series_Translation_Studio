CREATE TABLE IF NOT EXISTS reference_blocks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  block_index INTEGER NOT NULL,
  reference_text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(book_id) REFERENCES books(id),
  FOREIGN KEY(document_id) REFERENCES source_documents(id),
  UNIQUE(document_id, block_index)
);

CREATE INDEX IF NOT EXISTS idx_reference_blocks_project_book
  ON reference_blocks(project_id, book_id, block_index);

CREATE TABLE IF NOT EXISTS alignment_pairs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  source_block_id TEXT NOT NULL,
  reference_block_id TEXT NOT NULL,
  source_text TEXT NOT NULL,
  reference_text TEXT NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',
  promoted_tm_unit_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(book_id) REFERENCES books(id),
  FOREIGN KEY(source_block_id) REFERENCES text_blocks(id),
  FOREIGN KEY(reference_block_id) REFERENCES reference_blocks(id),
  FOREIGN KEY(promoted_tm_unit_id) REFERENCES tm_units(id),
  UNIQUE(project_id, book_id, source_block_id, reference_block_id)
);

CREATE INDEX IF NOT EXISTS idx_alignment_pairs_project_book
  ON alignment_pairs(project_id, book_id, status, confidence DESC);
