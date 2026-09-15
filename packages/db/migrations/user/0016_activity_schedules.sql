-- Editor values remain on activities. Versions make repeated edits take effect
-- on the next local date without rewriting today's target or past history.
CREATE TABLE activity_schedules (
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  effective_date TEXT NOT NULL,
  settings_json TEXT,
  PRIMARY KEY (activity_id, effective_date)
);
