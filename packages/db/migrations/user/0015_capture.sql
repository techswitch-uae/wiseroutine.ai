-- Capture metadata is private to this user's database. Files are opaque,
-- bounded chunks, never public URLs or executable app assets.
ALTER TABLE reminders ADD COLUMN activity_id TEXT;
ALTER TABLE reminders ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE reminders ADD COLUMN links_json TEXT NOT NULL DEFAULT '[]';
CREATE TABLE _captures (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  response TEXT NOT NULL
);
CREATE TABLE _todo_files (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL,
  todo_id TEXT,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  digest TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX todo_files_capture ON _todo_files(capture_id);
CREATE INDEX todo_files_todo ON _todo_files(todo_id);
CREATE TABLE _todo_file_chunks (
  file_id TEXT NOT NULL REFERENCES _todo_files(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY(file_id, position)
);
UPDATE reminders SET activity_id = (SELECT activity_id FROM slots WHERE slots.id = reminders.slot_id);
-- Repair the old lifecycle gap without assigning old slots to other todos.
UPDATE reminders SET status = 'done'
WHERE status = 'slotted' AND slot_id IN (SELECT id FROM slots WHERE status = 'completed');
UPDATE reminders SET status = 'open', slot_id = NULL
WHERE status = 'slotted' AND (slot_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM slots WHERE slots.id = reminders.slot_id)
  OR slot_id IN (SELECT id FROM slots WHERE status IN ('cancelled','skipped','missed')));
UPDATE reminders SET status = 'open'
WHERE status = 'slotted' AND slot_id IN (SELECT id FROM slots WHERE status = 'bucketed');
