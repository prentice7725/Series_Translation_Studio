CREATE TABLE IF NOT EXISTS post_read_corrections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  source_text TEXT NOT NULL,
  before_text TEXT NOT NULL,
  corrected_text TEXT NOT NULL,
  note TEXT,
  promoted_tm_unit_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(book_id) REFERENCES books(id),
  FOREIGN KEY(segment_id) REFERENCES translation_segments(id),
  FOREIGN KEY(promoted_tm_unit_id) REFERENCES tm_units(id)
);

CREATE INDEX IF NOT EXISTS idx_post_read_project_book
  ON post_read_corrections(project_id, book_id);

CREATE INDEX IF NOT EXISTS idx_post_read_segment
  ON post_read_corrections(segment_id);
