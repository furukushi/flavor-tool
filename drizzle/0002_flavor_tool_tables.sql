DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE flavor_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  default_fields TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE flavors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  influence INTEGER NOT NULL DEFAULT 50,
  extra_fields TEXT NOT NULL DEFAULT '[]',
  image_blob_key TEXT,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE flavor_type_links (
  flavor_id TEXT NOT NULL,
  type_id TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE generation_jobs (
  id TEXT PRIMARY KEY,
  flavor_id TEXT NOT NULL,
  flavor_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  base_snapshot TEXT NOT NULL DEFAULT '{}',
  full_snapshot TEXT NOT NULL DEFAULT '{}',
  consider_context INTEGER NOT NULL DEFAULT 1,
  request_text TEXT NOT NULL DEFAULT '',
  result_snapshot TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
--> statement-breakpoint
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO flavor_types (id, name, default_fields, sort_order, created_at, updated_at) VALUES ('type-background', '背景', '[]', 1, 0, 0);
--> statement-breakpoint
INSERT INTO flavor_types (id, name, default_fields, sort_order, created_at, updated_at) VALUES ('type-relationship', '関係性', '[]', 2, 0, 0);
--> statement-breakpoint
INSERT INTO flavor_types (id, name, default_fields, sort_order, created_at, updated_at) VALUES ('type-place', '場所', '[]', 3, 0, 0);
--> statement-breakpoint
INSERT INTO flavor_types (id, name, default_fields, sort_order, created_at, updated_at) VALUES ('type-time', '時間', '[]', 4, 0, 0);
