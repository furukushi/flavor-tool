export const ROLES = ["事実", "振る舞い", "禁止", "条件", "具体例", "その他"] as const;
export type Role = (typeof ROLES)[number];

export interface ExtraField {
label: string;
role: Role;
value: string;
}

export interface FlavorLike {
name: string;
typeNames: string[];
summary: string;
influence: number;
ignoreCharacterSettings: boolean;
extraFields: ExtraField[];
}

/** §13 base wording per influence tier (7 tiers). */
function influenceBaseText(v: number): string {
if (v <= 9) return "ほぼ意識しなくてよい。必要な時だけ参考にすること";
if (v <= 24) return "軽く意識する程度に留め、掛け合いの流れを優先すること";
if (v <= 39) return "意識して反映するが、無理のない範囲でよい";
if (v <= 54) return "はっきり意識して反映すること";
if (v <= 69) return "積極的に反映すること。迷った場合はこのフレーバーを優先すること";
if (v <= 84) return "強く反映すること。場面の前提として扱うこと";
return "最優先で厳密に反映すること。常にこのフレーバーを前提にすること";
}

/**
 * Conflict clause appended when ignoreCharacterSettings is on. It scales with
 * the influence tier: at low influence the character settings effectively
 * still win, mid tiers blend both unless the conflict is large, and the top
 * tiers prioritize this flavor, fully ignoring the character settings at max.
 */
function ignoreConflictText(v: number): string {
if (v <= 9) return "キャラ設定と矛盾する場合は、キャラ設定を優先すること";
if (v <= 24) return "キャラ設定と大きく矛盾しない範囲で、混ぜて反映すること";
if (v <= 39) return "キャラ設定と矛盾しすぎない範囲で、両方を混ぜて反映すること";
if (v <= 54) return "キャラ設定と矛盾しすぎていなければ混ぜて反映し、大きく矛盾する場合はこのフレーバーを優先すること";
if (v <= 69) return "キャラ設定よりこのフレーバーを優先するが、矛盾が小さい部分ではキャラ設定も活かすこと";
if (v <= 84) return "キャラ設定と矛盾する場合は、このフレーバーを優先し、キャラ設定の該当部分は無視すること";
return "キャラ設定を無視し、このフレーバーを最優先で反映すること";
}

/**
 * §13 tier wording for a single flavor's output: the tier's base wording plus
 * the character-settings conflict clause, which depends on the flavor's
 * ignoreCharacterSettings flag.
 * - off, 0–54%: character settings win on conflict.
 * - off, 55–100%: reflect within the bounds of the character settings.
 * - on: the conflict clause scales with the influence tier (see
 *   ignoreConflictText), from effectively-off at 0–9% to full ignore at
 *   85–100%.
 */
export function influenceTierText(v: number, ignoreCharacterSettings: boolean): string {
const base = influenceBaseText(v);
if (ignoreCharacterSettings) {
return `${base}。${ignoreConflictText(v)}`;
}
if (v <= 54) {
return `${base}。キャラ設定と矛盾する場合は、キャラ設定を優先すること`;
}
return `${base}。ただしキャラ設定の範囲内で反映すること`;
}

const ROLE_ORDER: Record<Role, number> = {
事実: 0,
条件: 1,
振る舞い: 2,
具体例: 3,
その他: 4,
禁止: 5,
};

function sortedFields(fields: ExtraField[]): ExtraField[] {
return fields
.map((f, i) => ({ f, i}))
.filter(({ f}) => f.value.trim()!== "")
.sort((a, b) => ROLE_ORDER[a.f.role] - ROLE_ORDER[b.f.role] || a.i - b.i)
.map(({ f}) => f);
}

function block(f: FlavorLike, withInstruction: boolean): string {
const lines: string[] = [`${f.name}`];
if (f.typeNames.length > 0) lines.push(`カテゴリ: ${f.typeNames.join(" / ")}`);
lines.push(
withInstruction
? `影響度: ${f.influence}%（${influenceTierText(f.influence, f.ignoreCharacterSettings)}）`
: `影響度: ${f.influence}%`,
);
if (f.summary.trim()!== "") lines.push(`概要: ${f.summary}`);
const head = lines.join("\n");
const fields = sortedFields(f.extraFields);
if (fields.length === 0) return head;
const body = fields.map((x) => `■ ${x.label}\n${x.value}`).join("\n\n");
return `${head}\n\n${body}`;
}

/** §9.2 single-flavor text output. */
export function formatSingle(f: FlavorLike): string {
return block(f, true);
}

export interface SortableFlavor {
name: string;
createdAt: string;
lastUsedAt: string | null;
}

/** あいうえお順: name string collation order, ties by oldest created first. */
export function sortGojuon<T extends SortableFlavor>(list: T[]): T[] {
return [...list].sort((a, b) => {
if (a.name < b.name) return -1;
if (a.name > b.name) return 1;
return a.createdAt < b.createdAt? -1: a.createdAt > b.createdAt? 1: 0;
});
}

/** 使った順: last used newest first; never-used go last in あいうえお順. */
export function sortUsed<T extends SortableFlavor>(list: T[]): T[] {
const used = list.filter((f) => f.lastUsedAt!= null);
const unused = list.filter((f) => f.lastUsedAt == null);
used.sort((a, b) => ((a.lastUsedAt?? "") < (b.lastUsedAt?? "")? 1: -1));
return [...used,...sortGojuon(unused)];
}

export function formatDateTime(iso: string | null): string {
if (!iso) return "—";
const d = new Date(iso);
return d.toLocaleString("ja-JP", {
year: "numeric",
month: "numeric",
day: "numeric",
hour: "2-digit",
minute: "2-digit",
});
}
