import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import { api, type ApiResponse } from "./api";
import type { Actions } from "../../server/src/actions";
import {
ROLES,
formatSingle,
influenceTierText,
type ExtraField,
type Role,
} from "./format";

const FIELDS = actionFields<typeof Actions>();

type State = ApiResponse<typeof api, "getState">;
export type Flavor = State["flavors"][number];
export type FlavorType = State["types"][number];

export function Editor({
  flavor,
  types,
  considerContext,
  onDone,
}: {
  flavor: Flavor | null;
  types: FlavorType[];
  considerContext: boolean;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(flavor?.name ?? "");
  const [summary, setSummary] = useState(flavor?.summary ?? "");
  const [influence, setInfluence] = useState(flavor?.influence ?? 50);
  const [ignoreChar, setIgnoreChar] = useState(flavor?.ignoreCharacterSettings ?? false);
  const [typeIds, setTypeIds] = useState<string[]>(flavor?.typeIds ?? []);
  const [fields, setFields] = useState<ExtraField[]>(
    flavor?.extraFields.map((f) => ({ ...f })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showAi, setShowAi] = useState(false);

  const initialSnapshot = useMemo(
    () =>
      JSON.stringify({
        name: flavor?.name ?? "",
        summary: flavor?.summary ?? "",
        influence: flavor?.influence ?? 50,
        ignoreChar: flavor?.ignoreCharacterSettings ?? false,
        typeIds: flavor?.typeIds ?? [],
        fields: flavor?.extraFields ?? [],
      }),
    [flavor],
  );
  const dirty =
    JSON.stringify({ name, summary, influence, ignoreChar, typeIds, fields }) !== initialSnapshot;

  const typeNames = typeIds
    .map((id) => types.find((t) => t.id === id)?.name)
    .filter((n): n is string => typeof n === "string");

  const previewText = formatSingle({
    name: name || "（名前未入力）",
    typeNames,
    summary,
    influence,
    ignoreCharacterSettings: ignoreChar,
    extraFields: fields,
  });

  function toggleType(t: FlavorType) {
    if (typeIds.includes(t.id)) {
      setTypeIds(typeIds.filter((id) => id !== t.id));
      return;
    }
    const nextIds = [...typeIds, t.id];
    setTypeIds(nextIds);
    // Auto-fill default fields of all selected types in selection order (§5 merge rule).
    setFields((prev) => {
      const merged = [...prev];
      for (const id of nextIds) {
        const ty = types.find((x) => x.id === id);
        if (!ty) continue;
        for (const df of ty.defaultFields) {
          if (!merged.some((f) => f.label === df.label)) {
            merged.push({ label: df.label, role: df.role, value: "" });
          }
        }
      }
      return merged.slice(0, 20);
    });
  }

  const saveMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      const payload = {
        name: name.trim(),
        summary,
        influence,
        ignoreCharacterSettings: ignoreChar,
        extraFields: fields,
        typeIds,
      };
      if (flavor?.id) {
        await api.updateFlavor({ id: flavor.id, ...payload });
      } else {
        await api.createFlavor(payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["state"] });
      onDone();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  function handleSave() {
    if (!name.trim()) {
      setNameError("名前を入力してください");
      return;
    }
    setNameError(null);
    setError(null);
    saveMutation.mutate();
  }

  function handleBack() {
    if (dirty) setConfirmLeave(true);
    else onDone();
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-10">
      <div className="flex items-center gap-2 py-3">
        <button
          type="button"
          onClick={handleBack}
          aria-label="一覧へ戻る"
          className="rounded-full bg-[var(--surface)] px-4 text-sm font-medium text-[var(--text)] shadow-[var(--shadow-card)]"
        >
          ← 一覧
        </button>
        <h2 className="text-lg font-bold text-[var(--text)]">
          {flavor ? "フレーバーを編集" : "フレーバーを作成"}
        </h2>
      </div>

      <div className="space-y-5">
        <div>
          <label htmlFor="flavor-name" className="mb-1 block text-sm font-medium text-[var(--text)]">
            名前 <span className="text-[var(--danger)]">*必須</span>
          </label>
          <input
            id="flavor-name"
            {...FIELDS.createFlavor.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 豪雨の日のコロニー"
            className="w-full rounded-2xl border-2 border-transparent bg-[var(--surface)] px-4 py-2.5 text-base text-[var(--text)] shadow-[var(--shadow-card)]"
          />
          {nameError && <p className="mt-1 text-sm text-[var(--danger)]">{nameError}</p>}
        </div>

        <div className="rounded-3xl bg-[var(--accent-soft)] p-4">
          <button
            type="button"
            onClick={() => setShowAi(true)}
            className="w-full rounded-full bg-[var(--accent)] py-3 text-base font-bold text-[var(--accent-text)] shadow-[var(--shadow-card)] hover:bg-[var(--accent-hover)]"
          >
            AI自動生成
          </button>
          <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
            名前を土台に、AIがカテゴリ・概要・影響度・追加説明を自動で作成します。土台にする項目の選択と方針リクエストは次の画面で指定できます。
          </p>
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium text-[var(--text)]">カテゴリ（複数選択可）</span>
          <div className="flex flex-wrap gap-2">
            {types.map((t) => {
              const on = typeIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={`カテゴリ ${t.name}`}
                  onClick={() => toggleType(t)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                    on
                      ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-[var(--shadow-card)]"
                      : "bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-card)]"
                  }`}
                >
                  {t.name}
                </button>
              );
            })}
            {types.length === 0 && (
              <p className="text-sm text-[var(--dim)]">カテゴリが未登録です。カテゴリ管理から追加できます。</p>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--dim)]">
            カテゴリを選ぶと、そのカテゴリのデフォルト項目が追加説明へ自動で補われます。
          </p>
        </div>

        <div>
          <label htmlFor="flavor-summary" className="mb-1 block text-sm font-medium text-[var(--text)]">
            概要
          </label>
          <textarea
            id="flavor-summary"
            {...FIELDS.createFlavor.summary}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            className="w-full rounded-2xl border-2 border-transparent bg-[var(--surface)] px-4 py-2.5 text-base text-[var(--text)] shadow-[var(--shadow-card)]"
          />
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium text-[var(--text)]">影響度</span>
          <div className="flex items-center gap-3">
            <input
              type="range"
              aria-label="影響度スライダー"
              min={0}
              max={100}
              step={1}
              value={influence}
              onChange={(e) => setInfluence(Number(e.target.value))}
              className="min-h-0 flex-1 accent-[var(--accent)]"
            />
            <span className="flex items-center gap-1">
              <input
                type="number"
                aria-label="影響度（数値）"
                {...FIELDS.createFlavor.influence}
                value={influence}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setInfluence(Math.max(0, Math.min(100, Math.round(v))));
                }}
                className="w-20 rounded-xl border-2 border-transparent bg-[var(--surface)] px-2 py-1 text-right text-base font-bold text-[var(--text)] shadow-[var(--shadow-card)]"
              />
              <span className="text-sm text-[var(--dim)]">%</span>
            </span>
          </div>
          <div className="mt-2 rounded-2xl bg-[var(--surface-alt)] px-4 py-3">
            <p className="text-xs text-[var(--dim)]">AIへ送る指示文（この文面がそのまま出力に含まれます）</p>
            <p className="mt-0.5 text-sm text-[var(--text)]">{influenceTierText(influence, ignoreChar)}</p>
          </div>
        </div>

        <div>
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-[var(--text)]">
            <input
              type="checkbox"
              aria-label="キャラ設定を無視する"
              checked={ignoreChar}
              onChange={(e) => setIgnoreChar(e.target.checked)}
              className="h-5 w-5 accent-[var(--accent)]"
            />
            キャラ設定を無視する
          </label>
          <p className="text-xs leading-relaxed text-[var(--dim)]">
            オンにすると、キャラ設定と矛盾する場合の扱いが影響度に応じて変わる指示文が出力されます（低めでは矛盾しすぎなければ混ぜて反映し、高めではこのフレーバーを優先してキャラ設定を無視します）。オフの場合は影響度に応じてキャラ設定が優先されます（上の指示文プレビューに反映されます）。AI自動生成では変更されません。
          </p>
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium text-[var(--text)]">
            追加説明（{fields.length}/20件）
          </span>
          <div className="space-y-3">
            {fields.map((f, i) => (
              <div key={i} className="rounded-3xl bg-[var(--surface)] p-4 shadow-[var(--shadow-card)]">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label={`追加説明 ${i + 1} の項目名`}
                    {...FIELDS.createFlavor.extraFields.label}
                    value={f.label}
                    onChange={(e) =>
                      setFields(fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                    }
                    placeholder="項目名（例: 具体的な説明）"
                    className="min-w-32 flex-1 rounded-xl border-2 border-transparent bg-[var(--surface-alt)] px-3 py-1 text-sm font-medium text-[var(--text)]"
                  />
                  <select
                    aria-label={`追加説明 ${i + 1} の役割`}
                    value={f.role}
                    onChange={(e) =>
                      setFields(
                        fields.map((x, j) => (j === i ? { ...x, role: e.target.value as Role } : x)),
                      )
                    }
                    className="rounded-xl border-2 border-transparent bg-[var(--surface-alt)] px-3 py-1 text-sm text-[var(--text)]"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`追加説明 ${i + 1} を上へ`}
                    disabled={i === 0}
                    onClick={() =>
                      setFields((prev) => {
                        const next = [...prev];
                        const cur = next[i];
                        const prevItem = next[i - 1];
                        if (cur && prevItem) {
                          next[i] = prevItem;
                          next[i - 1] = cur;
                        }
                        return next;
                      })
                    }
                    className="px-2 text-sm text-[var(--dim)] disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`追加説明 ${i + 1} を下へ`}
                    disabled={i === fields.length - 1}
                    onClick={() =>
                      setFields((prev) => {
                        const next = [...prev];
                        const cur = next[i];
                        const nxt = next[i + 1];
                        if (cur && nxt) {
                          next[i] = nxt;
                          next[i + 1] = cur;
                        }
                        return next;
                      })
                    }
                    className="px-2 text-sm text-[var(--dim)] disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`追加説明 ${i + 1} を削除`}
                    onClick={() => setFields(fields.filter((_, j) => j !== i))}
                    className="px-2 text-sm text-[var(--danger)]"
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  aria-label={`追加説明 ${i + 1} の内容`}
                  {...FIELDS.createFlavor.extraFields.value}
                  value={f.value}
                  onChange={(e) =>
                    setFields(fields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                  }
                  rows={2}
                  className="mt-2 w-full rounded-xl border-2 border-transparent bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--text)]"
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={fields.length >= 20}
            onClick={() => setFields([...fields, { label: "", role: "事実", value: "" }])}
            className="mt-2 rounded-full bg-[var(--surface)] px-4 text-sm font-medium text-[var(--text)] shadow-[var(--shadow-card)] disabled:opacity-40"
          >
            ＋ 項目を追加
          </button>
        </div>

        {error && (
          <p role="alert" className="rounded-2xl bg-[var(--danger-soft)] px-4 py-3 text-sm font-medium text-[var(--danger)]">
            {error}
          </p>
        )}

        <div className="sticky bottom-3 z-10 mt-2 rounded-3xl bg-[var(--surface)]/95 px-4 py-3 shadow-[var(--shadow-pop)] backdrop-blur">
          <div className="flex flex-wrap items-stretch gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="rounded-full bg-[var(--accent)] px-6 py-3 font-bold text-[var(--accent-text)] shadow-[var(--shadow-card)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {saveMutation.isPending ? "保存中…" : "保存する"}
            </button>
            <button
              type="button"
              onClick={() => setShowAi(true)}
              className="flex-1 rounded-full bg-[var(--gold)] px-5 py-3 text-base font-bold text-white shadow-[var(--shadow-card)] hover:opacity-90 dark:text-[#2b2135]"
            >
              AI自動生成
            </button>
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              className="rounded-full bg-[var(--surface-alt)] px-5 text-sm font-medium text-[var(--text)]"
            >
              プレビュー
            </button>
          </div>
        </div>
      </div>

      {showPreview && (
        <Overlay onClose={() => setShowPreview(false)} title="テキスト出力プレビュー">
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-3xl bg-[var(--surface-alt)] p-4 text-sm text-[var(--text)]">
            {previewText}
          </pre>
          <p className="mt-2 text-xs text-[var(--dim)]">{previewText.length} 文字（目安）</p>
          <button
            type="button"
            onClick={() => setShowPreview(false)}
            className="mt-3 w-full rounded-full bg-[var(--accent)] py-2.5 font-bold text-[var(--accent-text)] shadow-[var(--shadow-card)] hover:bg-[var(--accent-hover)]"
          >
            閉じる
          </button>
        </Overlay>
      )}

      {confirmLeave && (
        <Overlay onClose={() => setConfirmLeave(false)} title="編集中の内容があります">
          <p className="text-sm text-[var(--text)]">
            保存していない変更は破棄されます。一覧へ戻りますか？
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmLeave(false)}
              className="flex-1 rounded-full bg-[var(--surface-alt)] py-2.5 text-sm font-medium text-[var(--text)]"
            >
              編集を続ける
            </button>
            <button
              type="button"
              onClick={onDone}
              className="flex-1 rounded-full bg-[var(--danger)] py-2.5 text-sm font-bold text-white"
            >
              破棄して戻る
            </button>
          </div>
        </Overlay>
      )}

      {showAi && (
        <AiPanel
          flavorId={flavor?.id ?? null}
          name={name}
          summary={summary}
          influence={influence}
          ignoreCharacterSettings={ignoreChar}
          fields={fields}
          typeIds={typeIds}
          considerContext={considerContext}
          onClose={() => setShowAi(false)}
          onEnqueued={onDone}
        />
      )}
    </div>
  );
}

export function Overlay({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4">
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-[var(--surface)] p-5 pb-safe shadow-[var(--shadow-pop)] sm:rounded-[28px]">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-[var(--text)]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded-full bg-[var(--surface-alt)] px-3 text-base text-[var(--dim)]"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AiPanel({
  flavorId,
  name,
  summary,
  influence,
  ignoreCharacterSettings,
  fields,
  typeIds,
  considerContext,
  onClose,
  onEnqueued,
}: {
  flavorId: string | null;
  name: string;
  summary: string;
  influence: number;
  ignoreCharacterSettings: boolean;
  fields: ExtraField[];
  typeIds: string[];
  considerContext: boolean;
  onClose: () => void;
  onEnqueued: () => void;
}) {
  const queryClient = useQueryClient();
  const [base, setBase] = useState({
    types: typeIds.length > 0,
    summary: summary.trim() !== "",
    // 影響度が初期値（50）のままなら土台に含めない。変更されている場合のみ初期チェックを入れる。
    influence: influence !== 50,
    extraFields: fields.some((f) => f.label.trim() !== "" || f.value.trim() !== ""),
  });
  const [consider, setConsiderLocal] = useState(considerContext);
  const setConsider = useMutation({
    mutationFn: (v: boolean) => api.setConsiderContext({ considerContext: v }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["state"] }),
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const [requestText, setRequestText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const enqueue = useMutation({
    mutationFn: async () => {
      let fid = flavorId;
      if (!fid) {
        const created = await api.createFlavor({
          name: name.trim(),
          summary,
          influence,
          ignoreCharacterSettings,
          extraFields: fields,
          typeIds,
        });
        fid = created.id;
      }
      return api.enqueueJob({
        flavorId: fid,
        name: name.trim(),
        summary,
        influence,
        ignoreCharacterSettings,
        extraFields: fields,
        typeIds,
        base,
        requestText,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["state"] });
      onEnqueued();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const nameMissing = name.trim() === "";
  const noBase =
    !base.types && !base.summary && !base.influence && !base.extraFields && requestText.trim() === "";

  const baseOptions: { key: keyof typeof base; label: string; has: boolean }[] = [
    { key: "types", label: "カテゴリ", has: typeIds.length > 0 },
    { key: "summary", label: "概要", has: summary.trim() !== "" },
    { key: "influence", label: `影響度（現在 ${influence}%）`, has: true },
    {
      key: "extraFields",
      label: "追加説明",
      has: fields.some((f) => f.label.trim() !== "" || f.value.trim() !== ""),
    },
  ];

  return (
    <Overlay onClose={onClose} title="AI自動作成">
      <p className="text-sm text-[var(--text)]">
        土台として渡した項目をもとに、AIが残りの項目を判断して埋めます。生成結果は名前以外の全項目へ上書き保存されます。
      </p>
      <p className="mt-2 text-xs text-[var(--dim)]">
        名前「{name || "（未入力）"}」は識別として渡りますが、AIが生成・変更することはありません。「キャラ設定を無視する」の設定もAIは変更しません。
      </p>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-[var(--text)]">土台として渡す項目</legend>
        <div className="mt-2 space-y-2">
          {baseOptions.map((opt) => (
            <label key={opt.key} className="flex min-h-9 items-center gap-2 text-sm text-[var(--text)]">
              <input
                type="checkbox"
                checked={base[opt.key]}
                onChange={(e) => setBase({ ...base, [opt.key]: e.target.checked })}
                className="h-5 w-5 accent-[var(--accent)]"
              />
              {opt.label}
              {!opt.has && <span className="text-xs text-[var(--dim)]">（未入力）</span>}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        <span className="text-sm font-medium text-[var(--text)]">自動生成の設定</span>
        <label className="mt-1 flex min-h-11 items-center gap-3 text-sm text-[var(--text)]">
          <input
            type="checkbox"
            aria-label="既存項目の文脈を考慮する"
            checked={consider}
            onChange={(e) => {
              setConsiderLocal(e.target.checked);
              setConsider.mutate(e.target.checked);
            }}
            className="h-5 w-5 accent-[var(--accent)]"
          />
          既存項目の文脈を考慮する
        </label>
      </div>

      <label htmlFor="ai-request" className="mt-4 block text-sm font-medium text-[var(--text)]">
        方針リクエスト（任意）
      </label>
      <textarea
        id="ai-request"
        {...FIELDS.enqueueJob.requestText}
        value={requestText}
        onChange={(e) => setRequestText(e.target.value)}
        rows={3}
        placeholder="例: 雨の音が聞こえる静かな場所として書いてほしい"
        className="mt-1 w-full rounded-2xl border-2 border-transparent bg-[var(--surface-alt)] px-4 py-2.5 text-sm text-[var(--text)]"
      />

      {nameMissing && (
        <p className="mt-3 text-sm text-[var(--danger)]">名前が無いと生成はできません。先に名前を入力してください。</p>
      )}
      {!nameMissing && noBase && (
        <p className="mt-3 text-sm text-[var(--danger)]">
          土台にする項目を1つ以上選ぶか、方針リクエストを入力してください。
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-full bg-[var(--surface-alt)] py-2.5 text-sm font-medium text-[var(--text)]"
        >
          閉じる
        </button>
        <button
          type="button"
          disabled={nameMissing || noBase || enqueue.isPending}
          onClick={() => enqueue.mutate()}
          className="flex-1 rounded-full bg-[var(--accent)] py-2.5 text-sm font-bold text-[var(--accent-text)] shadow-[var(--shadow-card)] hover:bg-[var(--accent-hover)] disabled:opacity-40"
        >
          {enqueue.isPending ? "投入中…" : "キューに入れる"}
        </button>
      </div>
      <p className="mt-2 text-xs text-[var(--dim)]">
        キューに入れると現在の入力内容が保存され、生成が終わるまでこのフレーバーは編集できません。Muse側がキューを確認して自動で実行します。
      </p>
    </Overlay>
  );
}
