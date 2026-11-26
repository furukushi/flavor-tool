import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ROLES = ["事実", "振る舞い", "禁止", "条件", "具体例", "その他"] as const;

export const flavorTypes = sqliteTable("flavor_types", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  defaultFields: text("default_fields").notNull().default("[]"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const flavors = sqliteTable("flavors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  summary: text("summary").notNull().default(""),
  influence: integer("influence").notNull().default(50),
  ignoreCharacterSettings: integer("ignore_character_settings").notNull().default(0),
  extraFields: text("extra_fields").notNull().default("[]"),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const flavorTypeLinks = sqliteTable("flavor_type_links", {
  flavorId: text("flavor_id").notNull(),
  typeId: text("type_id").notNull(),
});

export const generationJobs = sqliteTable("generation_jobs", {
  id: text("id").primaryKey(),
  flavorId: text("flavor_id").notNull(),
  flavorName: text("flavor_name").notNull().default(""),
  status: text("status", {
    enum: ["queued", "processing", "done", "failed", "cancelled"],
  })
    .notNull()
    .default("queued"),
  baseSnapshot: text("base_snapshot").notNull().default("{}"),
  fullSnapshot: text("full_snapshot").notNull().default("{}"),
  considerContext: integer("consider_context").notNull().default(1),
  requestText: text("request_text").notNull().default(""),
  resultSnapshot: text("result_snapshot"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
