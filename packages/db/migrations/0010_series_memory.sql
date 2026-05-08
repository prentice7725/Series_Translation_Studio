CREATE TABLE IF NOT EXISTS stylebook_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_stylebook_project_priority
  ON stylebook_entries(project_id, priority DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS character_profiles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  aliases TEXT,
  description TEXT,
  speech_style TEXT,
  translation_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_character_profiles_project_name
  ON character_profiles(project_id, name);

CREATE TABLE IF NOT EXISTS chapter_memories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  term_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(book_id) REFERENCES books(id),
  FOREIGN KEY(chapter_id) REFERENCES chapters(id),
  UNIQUE(project_id, chapter_id)
);

CREATE INDEX IF NOT EXISTS idx_chapter_memories_project_book
  ON chapter_memories(project_id, book_id);
