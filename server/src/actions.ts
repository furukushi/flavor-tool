import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";

const ROLES = ["事実", "振る舞い", "禁止", "条件", "具体例", "その他"] as const;
type Role = (typeof ROLES)[number];

const extraField = z.object({
  label: z.string().max(200),
  role: z.enum(ROLES),
  value: z.string().max(20000),
});
type ExtraField = z.infer<typeof extraField>;

const defaultField = z.object({
  label: z.string().max(200),
  role: z.enum(ROLES),
});
type DefaultField = z.infer<typeof defaultField>;

const flavorShape = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  influence: z.number(),
  ignoreCharacterSettings: z.boolean(),
  extraFields: z.array(extraField),
  typeIds: z.array(z.string()),
  typeNames: z.array(z.string()),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  locked: z.boolean(),
  activeJobId: z.string().nullable(),
  activeJobStatus: z.string().nullable(),
});
type FlavorOut = z.infer<typeof flavorShape>;

const typeShape = z.object({
  id: z.string(),
  name: z.string(),
  defaultFields: z.array(defaultField),
  sortOrder: z.number(),
  flavorCount: z.number(),
});

const jobShape = z.object({
  id: z.string(),
  flavorId: z.string(),
  flavorName: z.string(),
  status: z.string(),
  baseSnapshot: z.string(),
  fullSnapshot: z.string(),
  considerContext: z.boolean(),
  requestText: z.string(),
  resultSnapshot: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

function parseExtraFields(raw: string): ExtraField[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: ExtraField[] = [];
    for (const item of parsed) {
      if (
        item != null &&
        typeof item === "object" &&
        typeof (item as { label?: unknown }).label === "string" &&
        typeof (item as { value?: unknown }).value === "string" &&
        ROLES.includes((item as { role?: Role }).role as Role)
      ) {
        const it = item as ExtraField;
        out.push({ label: it.label, role: it.role, value: it.value });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function parseDefaultFields(raw: string): DefaultField[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: DefaultField[] = [];
    for (const item of parsed) {
      if (
        item != null &&
        typeof item === "object" &&
        typeof (item as { label?: unknown }).label === "string" &&
        ROLES.includes((item as { role?: Role }).role as Role)
      ) {
        const it = item as DefaultField;
        out.push({ label: it.label, role: it.role });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Validates user-entered extra fields for save. Throws a readable error. */
function validateExtraFieldsForSave(fields: ExtraField[]): ExtraField[] {
  const cleaned: ExtraField[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    const label = f.label.trim();
    if (!label) {
      if (f.value.trim()) {
        throw new Error("追加説明に、内容はあるのに項目名が空の項目があります。項目名を入力してください。");
      }
      continue;
    }
    if (seen.has(label)) {
      throw new Error(`追加説明の項目名「${label}」が重複しています。同じ項目名は1件までです。`);
    }
    seen.add(label);
    cleaned.push({ label, role: f.role, value: f.value });
  }
  if (cleaned.length > 20) {
    throw new Error("追加説明は20件までです。");
  }
  return cleaned;
}

/** Sanitizes AI-generated extra fields: dedupe (first wins), cap 20, roles already enum-checked by schema. */
function sanitizeGeneratedFields(fields: ExtraField[]): ExtraField[] {
  const out: ExtraField[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    const label = f.label.trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, role: f.role, value: f.value });
    if (out.length >= 20) break;
  }
  return out;
}

async function activeJobFor(
  ctx: Ctx,
  flavorId: string,
): Promise<{ id: string; status: string } | null> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select()
    .from(schema.generationJobs)
    .where(
      and(
        eq(schema.generationJobs.flavorId, flavorId),
        inArray(schema.generationJobs.status, ["queued", "processing"]),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? { id: row.id, status: row.status } : null;
}

async function assertNotLocked(ctx: Ctx, flavorId: string): Promise<void> {
  const job = await activeJobFor(ctx, flavorId);
  if (job) {
    throw new Error("このフレーバーはAI自動生成のキュー投入中のため、編集・削除・複製・出力はできません。");
  }
}

async function flavorOut(ctx: Ctx, row: typeof schema.flavors.$inferSelect): Promise<FlavorOut> {
  const db = ctx.db<typeof schema>();
  const links = await db
    .select()
    .from(schema.flavorTypeLinks)
    .where(eq(schema.flavorTypeLinks.flavorId, row.id));
  const typeIds = links.map((l) => l.typeId);
  let typeNames: string[] = [];
  if (typeIds.length > 0) {
    const types = await db
      .select()
      .from(schema.flavorTypes)
      .where(inArray(schema.flavorTypes.id, typeIds));
    const byId = new Map(types.map((t) => [t.id, t]));
    typeNames = typeIds
      .map((id) => byId.get(id)?.name)
      .filter((n): n is string => typeof n === "string");
  }
  const job = await activeJobFor(ctx, row.id);
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    influence: row.influence,
    ignoreCharacterSettings: row.ignoreCharacterSettings === 1,
    extraFields: parseExtraFields(row.extraFields),
    typeIds,
    typeNames,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    locked: job != null,
    activeJobId: job?.id ?? null,
    activeJobStatus: job?.status ?? null,
  };
}

async function replaceTypeLinks(
  ctx: Ctx,
  flavorId: string,
  typeIds: string[],
): Promise<void> {
  const db = ctx.db<typeof schema>();
  const valid = await db.select().from(schema.flavorTypes);
  const validIds = new Set(valid.map((t) => t.id));
  const deduped = [...new Set(typeIds)].filter((id) => validIds.has(id));
  const statements: BatchItem<"sqlite">[] = [
    db.delete(schema.flavorTypeLinks).where(eq(schema.flavorTypeLinks.flavorId, flavorId)),
    ...deduped.map((typeId) =>
      db.insert(schema.flavorTypeLinks).values({ flavorId, typeId }),
    ),
  ];
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
}

const okResponse = z.object({ ok: z.literal(true) });

const flavorInput = {
  name: z.string().trim().min(1, "名前を入力してください").max(200),
  summary: z.string().max(10000),
  influence: z.number().int().min(0).max(100),
  ignoreCharacterSettings: z.boolean(),
  extraFields: z.array(extraField).max(30),
  typeIds: z.array(z.string()).max(50),
};

export const Actions = {
  getState: defineAction({
    description: "Returns all flavors, types, generation jobs, and app settings for the flavor tool.",
    request: z.object({}),
    response: z.object({
      flavors: z.array(flavorShape),
      types: z.array(typeShape),
      jobs: z.array(jobShape),
      considerContext: z.boolean(),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const typeRows = await db
        .select()
        .from(schema.flavorTypes)
        .orderBy(asc(schema.flavorTypes.sortOrder), asc(schema.flavorTypes.createdAt));
      const flavorRows = await db.select().from(schema.flavors);
      const linkRows = await db.select().from(schema.flavorTypeLinks);
      const counts = new Map<string, number>();
      for (const l of linkRows) counts.set(l.typeId, (counts.get(l.typeId) ?? 0) + 1);
      const flavors: FlavorOut[] = [];
      for (const row of flavorRows) flavors.push(await flavorOut(ctx, row));
      const jobRows = await db
        .select()
        .from(schema.generationJobs)
        .orderBy(desc(schema.generationJobs.createdAt));
      const settingRows = await db
        .select()
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, "consider_context"));
      return {
        flavors,
        types: typeRows.map((t) => ({
          id: t.id,
          name: t.name,
          defaultFields: parseDefaultFields(t.defaultFields),
          sortOrder: t.sortOrder,
          flavorCount: counts.get(t.id) ?? 0,
        })),
        jobs: jobRows.map((j) => ({
          id: j.id,
          flavorId: j.flavorId,
          flavorName: j.flavorName,
          status: j.status,
          baseSnapshot: j.baseSnapshot,
          fullSnapshot: j.fullSnapshot,
          considerContext: j.considerContext === 1,
          requestText: j.requestText,
          resultSnapshot: j.resultSnapshot,
          error: j.error,
          createdAt: j.createdAt.toISOString(),
          startedAt: j.startedAt ? j.startedAt.toISOString() : null,
          finishedAt: j.finishedAt ? j.finishedAt.toISOString() : null,
        })),
        considerContext: settingRows[0]?.value !== "0",
      };
    },
  }),

  createFlavor: defineAction({
    description: "Creates a new flavor with name, types, summary, influence, and extra fields.",
    request: z.object(flavorInput),
    response: z.object({ id: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const fields = validateExtraFieldsForSave(args.extraFields);
      const id = crypto.randomUUID();
      await db.insert(schema.flavors).values({
        id,
        name: args.name,
        summary: args.summary,
        influence: args.influence,
        ignoreCharacterSettings: args.ignoreCharacterSettings ? 1 : 0,
        extraFields: JSON.stringify(fields),
      });
      await replaceTypeLinks(ctx, id, args.typeIds);
      ctx.invalidateQueries();
      return { id };
    },
  }),

  updateFlavor: defineAction({
    description: "Updates an existing flavor. Blocked while an AI generation job is active for it.",
    request: z.object({ id: z.string(), ...flavorInput }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await assertNotLocked(ctx, args.id);
      const fields = validateExtraFieldsForSave(args.extraFields);
      await db
        .update(schema.flavors)
        .set({
          name: args.name,
          summary: args.summary,
          influence: args.influence,
          ignoreCharacterSettings: args.ignoreCharacterSettings ? 1 : 0,
          extraFields: JSON.stringify(fields),
          updatedAt: new Date(),
        })
        .where(eq(schema.flavors.id, args.id));
      await replaceTypeLinks(ctx, args.id, args.typeIds);
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deleteFlavor: defineAction({
    description: "Deletes a flavor. Generation history is kept. Blocked while a job is active.",
    request: z.object({ id: z.string() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await assertNotLocked(ctx, args.id);
      await db.batch([
        db.delete(schema.flavorTypeLinks).where(eq(schema.flavorTypeLinks.flavorId, args.id)),
        db.delete(schema.flavors).where(eq(schema.flavors.id, args.id)),
      ]);
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  duplicateFlavor: defineAction({
    description: "Duplicates a flavor; the copy gets a suffixed name and no last-used time.",
    request: z.object({ id: z.string() }),
    response: z.object({ id: z.string(), name: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertNotLocked(ctx, args.id);
      const rows = await db
        .select()
        .from(schema.flavors)
        .where(eq(schema.flavors.id, args.id));
      const src = rows[0];
      if (!src) throw new Error("複製元のフレーバーが見つかりません。");
      const all = await db.select({ name: schema.flavors.name }).from(schema.flavors);
      const names = new Set(all.map((r) => r.name));
      let newName = `${src.name}のコピー`;
      if (names.has(newName)) {
        let n = 2;
        while (names.has(`${src.name}のコピー (${n})`)) n++;
        newName = `${src.name}のコピー (${n})`;
      }
      const id = crypto.randomUUID();
      await db.insert(schema.flavors).values({
        id,
        name: newName,
        summary: src.summary,
        influence: src.influence,
        ignoreCharacterSettings: src.ignoreCharacterSettings,
        extraFields: src.extraFields,
        lastUsedAt: null,
      });
      const links = await db
        .select()
        .from(schema.flavorTypeLinks)
        .where(eq(schema.flavorTypeLinks.flavorId, args.id));
      if (links.length > 0) {
        const stmts = links.map((l) =>
          db.insert(schema.flavorTypeLinks).values({ flavorId: id, typeId: l.typeId }),
        );
        const [first, ...rest] = stmts;
        if (first) await db.batch([first, ...rest]);
      }
      ctx.invalidateQueries();
      return { id, name: newName };
    },
  }),

  markUsed: defineAction({
    description: "Records successful clipboard copies: sets last_used_at to now for the given flavor ids.",
    request: z.object({ ids: z.array(z.string()).min(1).max(100) }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.flavors)
        .set({ lastUsedAt: new Date() })
        .where(inArray(schema.flavors.id, args.ids));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  createType: defineAction({
    description: "Creates a flavor type (category) in the shared master. Type names must be unique.",
    request: z.object({
      name: z.string().trim().min(1, "カテゴリ名を入力してください").max(100),
      defaultFields: z.array(defaultField).max(20),
    }),
    response: z.object({ id: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const existing = await db.select().from(schema.flavorTypes);
      if (existing.some((t) => t.name.trim() === args.name.trim())) {
        throw new Error(`カテゴリ「${args.name.trim()}」は既に登録されています。カテゴリ名は重複できません。`);
      }
      const seen = new Set<string>();
      for (const f of args.defaultFields) {
        const label = f.label.trim();
        if (!label) throw new Error("デフォルト項目の項目名が空です。");
        if (seen.has(label)) throw new Error(`デフォルト項目名「${label}」が重複しています。`);
        seen.add(label);
      }
      const id = crypto.randomUUID();
      const maxOrder = existing.reduce((m, t) => Math.max(m, t.sortOrder), 0);
      await db.insert(schema.flavorTypes).values({
        id,
        name: args.name.trim(),
        defaultFields: JSON.stringify(
          args.defaultFields.map((f) => ({ label: f.label.trim(), role: f.role })),
        ),
        sortOrder: maxOrder + 1,
      });
      ctx.invalidateQueries();
      return { id };
    },
  }),

  updateType: defineAction({
    description: "Renames a type and/or updates its default fields. Existing flavors are not retroactively changed.",
    request: z.object({
      id: z.string(),
      name: z.string().trim().min(1, "カテゴリ名を入力してください").max(100),
      defaultFields: z.array(defaultField).max(20),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const existing = await db.select().from(schema.flavorTypes);
      if (existing.some((t) => t.id !== args.id && t.name.trim() === args.name.trim())) {
        throw new Error(`カテゴリ「${args.name.trim()}」は既に登録されています。カテゴリ名は重複できません。`);
      }
      const seen = new Set<string>();
      for (const f of args.defaultFields) {
        const label = f.label.trim();
        if (!label) throw new Error("デフォルト項目の項目名が空です。");
        if (seen.has(label)) throw new Error(`デフォルト項目名「${label}」が重複しています。`);
        seen.add(label);
      }
      await db
        .update(schema.flavorTypes)
        .set({
          name: args.name.trim(),
          defaultFields: JSON.stringify(
            args.defaultFields.map((f) => ({ label: f.label.trim(), role: f.role })),
          ),
          updatedAt: new Date(),
        })
        .where(eq(schema.flavorTypes.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deleteType: defineAction({
    description: "Deletes a type from the master; flavors keep their other types and just lose this one.",
    request: z.object({ id: z.string() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.batch([
        db.delete(schema.flavorTypeLinks).where(eq(schema.flavorTypeLinks.typeId, args.id)),
        db.delete(schema.flavorTypes).where(eq(schema.flavorTypes.id, args.id)),
      ]);
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  exportJson: defineAction({
    description: "Builds a flavor-export/1.0 JSON document for one flavor or all flavors.",
    request: z.object({ flavorId: z.string().nullable() }),
    response: z.object({ json: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let rows = await db.select().from(schema.flavors);
      if (args.flavorId) rows = rows.filter((r) => r.id === args.flavorId);
      rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const flavors = [];
      for (const row of rows) {
        const out = await flavorOut(ctx, row);
        flavors.push({
          name: out.name,
          types: out.typeNames,
          summary: out.summary,
          influence: out.influence,
          ignoreCharacterSettings: out.ignoreCharacterSettings,
          extra_fields: out.extraFields.map((f) => ({
            label: f.label,
            role: f.role,
            value: f.value,
          })),
        });
      }
      const doc = {
        format: "flavor-export",
        format_version: "1.0",
        exported_at: new Date().toISOString(),
        flavors,
      };
      return { json: JSON.stringify(doc, null, 2) };
    },
  }),

  importJson: defineAction({
    description:
      "Imports a flavor-export/1.0 JSON document. Syntax/format errors fail everything; per-flavor validation errors allow partial success; unknown type names are auto-registered.",
    request: z.object({ json: z.string().min(1).max(2_000_000) }),
    response: z.object({
      fatalError: z.string().nullable(),
      importedCount: z.number(),
      addedTypes: z.array(z.string()),
      errors: z.array(z.object({ index: z.number(), name: z.string(), reason: z.string() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let parsed: unknown;
      try {
        parsed = JSON.parse(args.json);
      } catch {
        return {
          fatalError: "JSONの構文エラーです。1件も登録しませんでした。",
          importedCount: 0,
          addedTypes: [],
          errors: [],
        };
      }
      if (
        parsed == null ||
        typeof parsed !== "object" ||
        (parsed as { format?: unknown }).format !== "flavor-export" ||
        (parsed as { format_version?: unknown }).format_version !== "1.0" ||
        !Array.isArray((parsed as { flavors?: unknown }).flavors)
      ) {
        return {
          fatalError: "format / format_version が想定と異なるため、1件も登録しませんでした。",
          importedCount: 0,
          addedTypes: [],
          errors: [],
        };
      }
      const items = (parsed as { flavors: unknown[] }).flavors;
      const typeRows = await db.select().from(schema.flavorTypes);
      const typeByName = new Map(typeRows.map((t) => [t.name.trim(), t]));
      let maxOrder = typeRows.reduce((m, t) => Math.max(m, t.sortOrder), 0);
      const addedTypes: string[] = [];
      const errors: { index: number; name: string; reason: string }[] = [];
      let importedCount = 0;

      for (let i = 0; i < items.length; i++) {
        const raw = items[i];
        const fail = (name: string, reason: string) => errors.push({ index: i, name, reason });
        if (raw == null || typeof raw !== "object") {
          fail("", "オブジェクトではありません");
          continue;
        }
        const item = raw as Record<string, unknown>;
        const name = typeof item.name === "string" ? item.name.trim() : "";
        if (!name) {
          fail("", "名前がありません");
          continue;
        }
        const influenceRaw = item.influence;
        const influence =
          typeof influenceRaw === "number" && Number.isFinite(influenceRaw)
            ? Math.round(influenceRaw)
            : 50;
        if (influence < 0 || influence > 100) {
          fail(name, "影響度が0〜100の範囲外です");
          continue;
        }
        const summary = typeof item.summary === "string" ? item.summary : "";
        // Missing ignoreCharacterSettings in older exports defaults to off (backward compatible).
        const ignoreCharacterSettings = item.ignoreCharacterSettings === true ? 1 : 0;
        const rawFields = Array.isArray(item.extra_fields) ? item.extra_fields : [];
        const fields: ExtraField[] = [];
        let fieldError: string | null = null;
        const seenLabels = new Set<string>();
        for (const rf of rawFields) {
          if (rf == null || typeof rf !== "object") {
            fieldError = "追加説明の形式が不正です";
            break;
          }
          const f = rf as Record<string, unknown>;
          const label = typeof f.label === "string" ? f.label.trim() : "";
          const role = f.role as Role;
          const value = typeof f.value === "string" ? f.value : "";
          if (!label) {
            fieldError = "追加説明の項目名が空です";
            break;
          }
          if (!ROLES.includes(role)) {
            fieldError = `役割「${String(f.role)}」が選択肢にありません`;
            break;
          }
          if (seenLabels.has(label)) {
            fieldError = `追加説明の項目名「${label}」が重複しています`;
            break;
          }
          seenLabels.add(label);
          fields.push({ label, role, value });
        }
        if (fieldError) {
          fail(name, fieldError);
          continue;
        }
        if (fields.length > 20) {
          fail(name, "追加説明が20件を超えています");
          continue;
        }
        const rawTypes = Array.isArray(item.types) ? item.types : [];
        const typeIds: string[] = [];
        for (const rt of rawTypes) {
          if (typeof rt !== "string" || !rt.trim()) continue;
          const tName = rt.trim();
          let type = typeByName.get(tName);
          if (!type) {
            const id = crypto.randomUUID();
            maxOrder += 1;
            await db.insert(schema.flavorTypes).values({
              id,
              name: tName,
              defaultFields: "[]",
              sortOrder: maxOrder,
            });
            type = {
              id,
              name: tName,
              defaultFields: "[]",
              sortOrder: maxOrder,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            typeByName.set(tName, type);
            addedTypes.push(tName);
          }
          if (!typeIds.includes(type.id)) typeIds.push(type.id);
        }
        const id = crypto.randomUUID();
        await db.insert(schema.flavors).values({
          id,
          name,
          summary,
          influence,
          ignoreCharacterSettings,
          extraFields: JSON.stringify(fields),
        });
        if (typeIds.length > 0) {
          const stmts = typeIds.map((typeId) =>
            db.insert(schema.flavorTypeLinks).values({ flavorId: id, typeId }),
          );
          const [first, ...rest] = stmts;
          if (first) await db.batch([first, ...rest]);
        }
        importedCount++;
      }
      ctx.invalidateQueries();
      return { fatalError: null, importedCount, addedTypes, errors };
    },
  }),

  setConsiderContext: defineAction({
    description: "Sets the app-wide AI auto-generation setting: whether existing content is passed as context.",
    request: z.object({ considerContext: z.boolean() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db
        .insert(schema.appSettings)
        .values({ key: "consider_context", value: args.considerContext ? "1" : "0" })
        .onConflictDoUpdate({
          target: schema.appSettings.key,
          set: { value: args.considerContext ? "1" : "0" },
        });
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  enqueueJob: defineAction({
    description:
      "Saves the flavor's current input and enqueues an AI auto-generation job (queued). Name is required and is never a generation target.",
    request: z.object({
      flavorId: z.string().nullable(),
      ...flavorInput,
      base: z.object({
        types: z.boolean(),
        summary: z.boolean(),
        influence: z.boolean(),
        extraFields: z.boolean(),
      }),
      requestText: z.string().max(5000),
    }),
    response: z.object({ jobId: z.string(), flavorId: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      if (!args.name.trim()) {
        throw new Error("名前が無いと生成はできません。名前を入力してください。");
      }
      const anyBase = args.base.types || args.base.summary || args.base.influence || args.base.extraFields;
      if (!anyBase && !args.requestText.trim()) {
        throw new Error("土台にする項目を1つ以上選ぶか、方針リクエストを入力してください。");
      }
      const fields = validateExtraFieldsForSave(args.extraFields);
      let flavorId = args.flavorId;
      if (flavorId) {
        await assertNotLocked(ctx, flavorId);
        await db
          .update(schema.flavors)
          .set({
            name: args.name,
            summary: args.summary,
            influence: args.influence,
            ignoreCharacterSettings: args.ignoreCharacterSettings ? 1 : 0,
            extraFields: JSON.stringify(fields),
            updatedAt: new Date(),
          })
          .where(eq(schema.flavors.id, flavorId));
      } else {
        flavorId = crypto.randomUUID();
        await db.insert(schema.flavors).values({
          id: flavorId,
          name: args.name,
          summary: args.summary,
          influence: args.influence,
          ignoreCharacterSettings: args.ignoreCharacterSettings ? 1 : 0,
          extraFields: JSON.stringify(fields),
        });
      }
      await replaceTypeLinks(ctx, flavorId, args.typeIds);
      const typeRows = await db
        .select()
        .from(schema.flavorTypes)
        .where(inArray(schema.flavorTypes.id, args.typeIds));
      const typeNames = typeRows.map((t) => t.name);
      const full = {
        name: args.name,
        types: typeNames,
        summary: args.summary,
        influence: args.influence,
        ignoreCharacterSettings: args.ignoreCharacterSettings,
        extraFields: fields,
      };
      const base: Record<string, unknown> = { name: args.name };
      if (args.base.types) base.types = typeNames;
      if (args.base.summary) base.summary = args.summary;
      if (args.base.influence) base.influence = args.influence;
      if (args.base.extraFields) base.extraFields = fields;
      const settingRows = await db
        .select()
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, "consider_context"));
      const considerContext = settingRows[0]?.value !== "0";
      const jobId = crypto.randomUUID();
      await db.insert(schema.generationJobs).values({
        id: jobId,
        flavorId,
        flavorName: args.name,
        status: "queued",
        baseSnapshot: JSON.stringify(base),
        fullSnapshot: JSON.stringify(full),
        considerContext: considerContext ? 1 : 0,
        requestText: args.requestText,
      });
      ctx.invalidateQueries();
      return { jobId, flavorId };
    },
  }),

  cancelJob: defineAction({
    description: "Cancels a queued or processing generation job; the flavor unlocks immediately and the result must never be applied afterwards.",
    request: z.object({ jobId: z.string() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.generationJobs)
        .where(eq(schema.generationJobs.id, args.jobId));
      const job = rows[0];
      if (!job) throw new Error("ジョブが見つかりません。");
      if (job.status === "queued" || job.status === "processing") {
        await db
          .update(schema.generationJobs)
          .set({ status: "cancelled", finishedAt: new Date() })
          .where(eq(schema.generationJobs.id, args.jobId));
      }
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  listQueuedJobs: defineAction({
    description: "Sweep API for the Muse side: returns queued generation jobs in enqueue order with their base/full snapshots, request text, context flag, and the current type master names.",
    request: z.object({}),
    response: z.object({
      jobs: z.array(
        z.object({
          id: z.string(),
          flavorId: z.string(),
          flavorName: z.string(),
          baseSnapshot: z.string(),
          fullSnapshot: z.string(),
          considerContext: z.boolean(),
          requestText: z.string(),
          createdAt: z.string(),
        }),
      ),
      typeNames: z.array(z.string()),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.generationJobs)
        .where(eq(schema.generationJobs.status, "queued"))
        .orderBy(asc(schema.generationJobs.createdAt));
      const typeRows = await db.select().from(schema.flavorTypes);
      return {
        jobs: rows.map((j) => ({
          id: j.id,
          flavorId: j.flavorId,
          flavorName: j.flavorName,
          baseSnapshot: j.baseSnapshot,
          fullSnapshot: j.fullSnapshot,
          considerContext: j.considerContext === 1,
          requestText: j.requestText,
          createdAt: j.createdAt.toISOString(),
        })),
        typeNames: typeRows.map((t) => t.name),
      };
    },
  }),

  startJob: defineAction({
    description: "Sweep API: moves a queued job to processing. Returns applied=false when the job is not queued (e.g. cancelled).",
    request: z.object({ jobId: z.string() }),
    response: z.object({ applied: z.boolean(), status: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.generationJobs)
        .where(eq(schema.generationJobs.id, args.jobId));
      const job = rows[0];
      if (!job) return { applied: false, status: "not_found" };
      if (job.status !== "queued") return { applied: false, status: job.status };
      await db
        .update(schema.generationJobs)
        .set({ status: "processing", startedAt: new Date() })
        .where(
          and(
            eq(schema.generationJobs.id, args.jobId),
            eq(schema.generationJobs.status, "queued"),
          ),
        );
      ctx.invalidateQueries();
      return { applied: true, status: "processing" };
    },
  }),

  applyJobResult: defineAction({
    description:
      "Sweep API: validates and applies a generated result over the flavor (name is never overwritten) and marks the job done. Conditional update: applies only while the job is processing; if cancelled, discards the result and reports applied=false.",
    request: z.object({
      jobId: z.string(),
      types: z.array(z.string()).max(50),
      summary: z.string().max(10000),
      influence: z.number().int().min(0).max(100),
      extraFields: z.array(extraField).max(40),
    }),
    response: z.object({ applied: z.boolean(), reason: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.generationJobs)
        .where(eq(schema.generationJobs.id, args.jobId));
      const job = rows[0];
      if (!job) return { applied: false, reason: "not_found" };
      if (job.status === "cancelled") {
        return { applied: false, reason: "cancelled" };
      }
      if (job.status !== "processing") {
        return { applied: false, reason: `status_${job.status}` };
      }
      // Validation/sanitization: types limited to the existing master, fields deduped and capped.
      const typeRows = await db.select().from(schema.flavorTypes);
      const typeByName = new Map(typeRows.map((t) => [t.name.trim(), t]));
      const typeIds: string[] = [];
      const typeNames: string[] = [];
      for (const n of args.types) {
        const t = typeByName.get(n.trim());
        if (t && !typeIds.includes(t.id)) {
          typeIds.push(t.id);
          typeNames.push(t.name);
        }
      }
      const fields = sanitizeGeneratedFields(args.extraFields);
      const flavorRows = await db
        .select()
        .from(schema.flavors)
        .where(eq(schema.flavors.id, job.flavorId));
      const flavor = flavorRows[0];
      if (!flavor) {
        await db
          .update(schema.generationJobs)
          .set({ status: "failed", error: "対象フレーバーが削除されています", finishedAt: new Date() })
          .where(eq(schema.generationJobs.id, args.jobId));
        ctx.invalidateQueries();
        return { applied: false, reason: "flavor_deleted" };
      }
      const result = {
        name: flavor.name,
        types: typeNames,
        summary: args.summary,
        influence: args.influence,
        extraFields: fields,
      };
      // Conditional write: only if the job is still processing at write time.
      const updated = await db
        .update(schema.generationJobs)
        .set({
          status: "done",
          resultSnapshot: JSON.stringify(result),
          finishedAt: new Date(),
        })
        .where(
          and(
            eq(schema.generationJobs.id, args.jobId),
            eq(schema.generationJobs.status, "processing"),
          ),
        )
        .returning({ id: schema.generationJobs.id });
      if (updated.length === 0) {
        return { applied: false, reason: "cancelled" };
      }
      await db
        .update(schema.flavors)
        .set({
          summary: args.summary,
          influence: args.influence,
          extraFields: JSON.stringify(fields),
          updatedAt: new Date(),
        })
        .where(eq(schema.flavors.id, job.flavorId));
      await replaceTypeLinks(ctx, job.flavorId, typeIds);
      ctx.invalidateQueries();
      return { applied: true, reason: "done" };
    },
  }),

  failJob: defineAction({
    description: "Sweep API: marks a queued or processing job as failed with a reason, unlocking the flavor.",
    request: z.object({ jobId: z.string(), error: z.string().max(2000) }),
    response: z.object({ applied: z.boolean(), status: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.generationJobs)
        .where(eq(schema.generationJobs.id, args.jobId));
      const job = rows[0];
      if (!job) return { applied: false, status: "not_found" };
      if (job.status !== "queued" && job.status !== "processing") {
        return { applied: false, status: job.status };
      }
      await db
        .update(schema.generationJobs)
        .set({ status: "failed", error: args.error, finishedAt: new Date() })
        .where(eq(schema.generationJobs.id, args.jobId));
      ctx.invalidateQueries();
      return { applied: true, status: "failed" };
    },
  }),
} satisfies ActionsModule;
