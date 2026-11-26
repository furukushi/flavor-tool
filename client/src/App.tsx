import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim, setFailureNoticeText } from "@hatch/space-sdk/client";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import { api, type ApiResponse } from "./api";
import type { Actions } from "../../server/src/actions";
import { Editor, Overlay, type Flavor, type FlavorType } from "./Editor";
import {
ROLES,
formatDateTime,
formatSingle,
influenceTierText,
sortGojuon,
sortUsed,
type Role,
} from "./format";

setFailureNoticeText((_error, message) => message);

const FIELDS = actionFields<typeof Actions>();
type State = ApiResponse<typeof api, "getState">;
type Job = State["jobs"][number];

type View =
  | { kind: "list" }
  | { kind: "editor"; flavorId: string | null }
  | { kind: "types" }
  | { kind: "history" }
  | { kind: "import" };

interface ConfirmState {
  title: string;
  message: string;
  actionLabel: string;
  onConfirm: () => void;
}

interface OutputState {
  title: string;
  text: string;
  usedIds: string[] | null; // null = preview / JSON (no usage marking)
  isJson?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "生成待ち",
  processing: "生成中",
  done: "完了",
  failed: "失敗",
  cancelled: "キャンセル済み",
};

export function App() {
  const queryClient = useQueryClient();
  const state = useQuery({
    queryKey: ["state"],
    queryFn: () => api.getState({}),
    refetchInterval: 10000,
  });
  const [view, setView] = useState<View>({ kind: "list" });
  const [sortMode, setSortMode] = useState<"gojuon" | "used">("gojuon");
  const [folderMode, setFolderMode] = useState(false);
  const [simpleMode, setSimpleMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem("flavor-simple-mode") === "1";
    } catch {
      return false;
    }
  });

  function changeSimpleMode(v: boolean) {
    setSimpleMode(v);
    try {
      localStorage.setItem("flavor-simple-mode", v ? "1" : "0");
    } catch {
      // storage unavailable: keep in-memory state only
    }
  }
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [output, setOutput] = useState<OutputState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }

  const markUsed = useMutation({
    mutationFn: (ids: string[]) => api.markUsed({ ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["state"] }),
  });
  const deleteFlavor = useMutation({
    mutationFn: (id: string) => api.deleteFlavor({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["state"] });
      showToast("削除しました");
    },
    onError: (e) => showToast(e instanceof Error ? e.message : String(e)),
  });
  const duplicateFlavor = useMutation({
    mutationFn: (id: string) => api.duplicateFlavor({ id }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["state"] });
      showToast(`「${r.name}」を作成しました`);
    },
    onError: (e) => showToast(e instanceof Error ? e.message : String(e)),
  });
  const cancelJob = useMutation({
    mutationFn: (jobId: string) => api.cancelJob({ jobId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["state"] });
      showToast("キャンセルを登録しました");
    },
    onError: (e) => showToast(e instanceof Error ? e.message : String(e)),
  });
  const exportJson = useMutation({
    mutationFn: (flavorId: string | null) => api.exportJson({ flavorId }),
    onSuccess: (r, flavorId) => {
      setOutput({
        title: flavorId ? "JSON出力（1件）" : "JSON出力（全件）",
        text: r.json,
        usedIds: null,
        isJson: true,
      });
    },
    onError: (e) => showToast(e instanceof Error ? e.message : String(e)),
  });
  const data = state.data;
  const flavors = useMemo(() => data?.flavors ?? [], [data]);
  const types = useMemo(() => data?.types ?? [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? flavors.filter(
          (f) =>
            f.name.toLowerCase().includes(q) ||
            f.summary.toLowerCase().includes(q) ||
            f.typeNames.some((n) => n.toLowerCase().includes(q)) ||
            f.extraFields.some(
              (x) => x.label.toLowerCase().includes(q) || x.value.toLowerCase().includes(q),
            ),
        )
      : flavors;
    return sortMode === "gojuon" ? sortGojuon(base) : sortUsed(base);
  }, [flavors, search, sortMode]);

  const editingFlavor =
    view.kind === "editor" && view.flavorId
      ? (flavors.find((f) => f.id === view.flavorId) ?? null)
      : null;

  function openSingleOutput(f: Flavor) {
    setOutput({ title: `コピー: ${f.name}`, text: formatSingle(f), usedIds: [f.id] });
  }

  async function handleInstantCopy(f: Flavor): Promise<boolean> {
    const text = formatSingle(f);
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      markUsed.mutate([f.id]);
      showToast("クリップボードにテキストをコピーしました");
      return true;
    }
    openSingleOutput(f);
    return false;
  }

  function askDelete(f: Flavor) {
    setConfirm({
      title: "フレーバーを削除",
      message: `「${f.name}」を削除しますか？この操作は取り消せません。（自動生成の履歴は残ります）`,
      actionLabel: "削除する",
      onConfirm: () => deleteFlavor.mutate(f.id),
    });
  }

  function askDeleteType(t: FlavorType) {
    setConfirm({
      title: "カテゴリを削除",
      message: `カテゴリ「${t.name}」を削除しますか？使用中のフレーバー ${t.flavorCount} 件からこのカテゴリだけが外れます。`,
      actionLabel: "削除する",
      onConfirm: () => deleteType.mutate(t.id),
    });
  }

  const deleteType = useMutation({
    mutationFn: (id: string) => api.deleteType({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["state"] });
      showToast("カテゴリを削除しました");
    },
    onError: (e) => showToast(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      {view.kind === "editor" ? (
        <Editor
          key={view.flavorId ?? "new"}
          flavor={editingFlavor}
          types={types}
          considerContext={data?.considerContext ?? true}
          onDone={() => setView({ kind: "list" })}
        />
      ) : view.kind === "types" ? (
        <TypesView types={types} onBack={() => setView({ kind: "list" })} onDeleteType={askDeleteType} showToast={showToast} />
      ) : view.kind === "history" ? (
        <HistoryView
          jobs={data?.jobs ?? []}
          onBack={() => setView({ kind: "list" })}
          onCancelJob={(job) =>
            setConfirm({
              title: "生成をキャンセル",
              message: `「${job.flavorName}」の自動生成をキャンセルしますか？キャンセルが登録されると、結果があっても代入されません。ロックは即時解除されます。`,
              actionLabel: "キャンセルする",
              onConfirm: () => cancelJob.mutate(job.id),
            })
          }
        />
      ) : view.kind === "import" ? (
        <ImportView onBack={() => setView({ kind: "list" })} showToast={showToast} />
      ) : (
        <main className="mx-auto w-full max-w-6xl px-4 pb-10">
          {/* Controls */}
          <div className="flex gap-2 pt-4">
            <input
              type="search"
              aria-label="フレーバーを検索"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="名前・概要・追加説明・カテゴリ名で検索"
              className="min-w-0 flex-1 rounded-full border-2 border-transparent bg-[var(--surface)] px-4 py-2 text-base text-[var(--text)] shadow-[var(--shadow-card)] placeholder:text-[var(--dim)]"
            />
            <button
              type="button"
              onClick={() => setView({ kind: "editor", flavorId: null })}
              className="shrink-0 rounded-full bg-[var(--accent)] px-5 font-bold text-[var(--accent-text)] shadow-[var(--shadow-card)] hover:bg-[var(--accent-hover)]"
            >
              ＋ 新規作成
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-[var(--dim)]" htmlFor="flavor-sort">
                並び替え
              </label>
              <select
                id="flavor-sort"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as "gojuon" | "used")}
                className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-bold text-[var(--text)]"
              >
                <option value="gojuon">五十音順</option>
                <option value="used">最近使用した順</option>
              </select>
            </div>
            <div className="relative ml-auto">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={showMenu}
                aria-label="その他のメニュー"
                onClick={() => setShowMenu(!showMenu)}
                className="rounded-full bg-[var(--surface)] px-4 text-sm font-medium text-[var(--text)] shadow-[var(--shadow-card)]"
              >
                その他
              </button>
              {showMenu && (
                <>
                  <button
                    type="button"
                    aria-hidden="true"
                    tabIndex={-1}
                    onClick={() => setShowMenu(false)}
                    className="fixed inset-0 z-30 cursor-default"
                  />
                  <div
                    role="menu"
                    aria-label="その他のメニュー"
                    className="absolute right-0 z-40 mt-2 w-64 rounded-3xl bg-[var(--surface)] p-2 shadow-[var(--shadow-pop)]"
                  >
                    <span className="block px-3 pt-2 pb-1 text-xs text-[var(--dim)]">表示モード</span>
                    <div className="flex gap-1 rounded-full bg-[var(--surface-alt)] p-1" role="group" aria-label="表示モード">
                      <button
                        type="button"
                        aria-pressed={!folderMode}
                        onClick={() => setFolderMode(false)}
                        className={`flex-1 rounded-full px-3 text-sm font-medium ${!folderMode ? "bg-[var(--accent)] text-[var(--accent-text)]" : "text-[var(--dim)]"}`}
                      >
                        通常
                      </button>
                      <button
                        type="button"
                        aria-pressed={folderMode}
                        onClick={() => setFolderMode(true)}
                        className={`flex-1 rounded-full px-3 text-sm font-medium ${folderMode ? "bg-[var(--accent)] text-[var(--accent-text)]" : "text-[var(--dim)]"}`}
                      >
                        カテゴリ
                      </button>
                    </div>
                    <span className="mt-2 block border-t border-[var(--border)] px-3 pt-3 pb-1 text-xs text-[var(--dim)]">表示の細かさ</span>
                    <div className="flex gap-1 rounded-full bg-[var(--surface-alt)] p-1" role="group" aria-label="表示の細かさ">
                      <button
                        type="button"
                        aria-pressed={simpleMode}
                        onClick={() => changeSimpleMode(true)}
                        className={`flex-1 rounded-full px-3 text-sm font-medium ${simpleMode ? "bg-[var(--accent)] text-[var(--accent-text)]" : "text-[var(--dim)]"}`}
                      >
                        簡易
                      </button>
                      <button
                        type="button"
                        aria-pressed={!simpleMode}
                        onClick={() => changeSimpleMode(false)}
                        className={`flex-1 rounded-full px-3 text-sm font-medium ${!simpleMode ? "bg-[var(--accent)] text-[var(--accent-text)]" : "text-[var(--dim)]"}`}
                      >
                        詳細
                      </button>
                    </div>
                    <div className="mt-2 border-t border-[var(--border)] pt-2">
                      {(
                        [
                          ["カテゴリ管理", () => setView({ kind: "types" })],
                          ["自動生成履歴", () => setView({ kind: "history" })],
                          [
                            "JSON出力（全件）",
                            () => exportJson.mutate(null),
                          ],
                          ["JSON取り込み", () => setView({ kind: "import" })],
                        ] as const
                      ).map(([label, act]) => (
                        <button
                          key={label}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setShowMenu(false);
                            act();
                          }}
                          className="block w-full rounded-2xl px-3 py-2.5 text-left text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-alt)]"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* List */}
          {state.isPending ? (
            <p className="py-12 text-center text-sm text-[var(--dim)]">読み込み中…</p>
          ) : state.isError ? (
            <p className="py-12 text-center text-sm text-[var(--danger)]">
              読み込みに失敗しました。再読み込みしてください。
            </p>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-[var(--dim)]">
                {flavors.length === 0
                  ? "フレーバーはまだありません。「＋ 新規作成」から作れます。"
                  : "条件に合うフレーバーがありません。"}
              </p>
            </div>
          ) : folderMode ? (
            <FolderList
              flavors={filtered}
              types={types}
              simple={simpleMode}
              onOutput={openSingleOutput}
              onInstantCopy={handleInstantCopy}
              onEdit={(f) => setView({ kind: "editor", flavorId: f.id })}
              onDuplicate={(f) => duplicateFlavor.mutate(f.id)}
              onJson={(f) => exportJson.mutate(f.id)}
              onDelete={askDelete}
              onCancelJob={(f) =>
                f.activeJobId &&
                setConfirm({
                  title: "生成をキャンセル",
                  message: `「${f.name}」の自動生成をキャンセルしますか？結果があっても代入されません。`,
                  actionLabel: "キャンセルする",
                  onConfirm: () => f.activeJobId && cancelJob.mutate(f.activeJobId),
                })
              }
            />
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((f) => (
                <FlavorCard
                  key={f.id}
                  flavor={f}
                  simple={simpleMode}
                  onOutput={() => openSingleOutput(f)}
                  onInstantCopy={() => handleInstantCopy(f)}
                  onEdit={() => setView({ kind: "editor", flavorId: f.id })}
                  onDuplicate={() => duplicateFlavor.mutate(f.id)}
                  onJson={() => exportJson.mutate(f.id)}
                  onDelete={() => askDelete(f)}
                  onCancelJob={() =>
                    f.activeJobId &&
                    setConfirm({
                      title: "生成をキャンセル",
                      message: `「${f.name}」の自動生成をキャンセルしますか？結果があっても代入されません。`,
                      actionLabel: "キャンセルする",
                      onConfirm: () => f.activeJobId && cancelJob.mutate(f.activeJobId),
                    })
                  }
                />
              ))}
            </div>
          )}
        </main>
      )}

      {confirm && (
        <Overlay title={confirm.title} onClose={() => setConfirm(null)}>
          <p className="text-sm leading-relaxed text-[var(--text)]">{confirm.message}</p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirm(null)}
              className="flex-1 rounded-full bg-[var(--surface-alt)] py-2.5 text-sm font-medium text-[var(--text)]"
            >
              やめる
            </button>
            <button
              type="button"
              onClick={() => {
                confirm.onConfirm();
                setConfirm(null);
              }}
              className="flex-1 rounded-full bg-[var(--danger)] py-2.5 text-sm font-bold text-white"
            >
              {confirm.actionLabel}
            </button>
          </div>
        </Overlay>
      )}

      {output && (
        <OutputModal
          output={output}
          onClose={() => setOutput(null)}
          onCopied={() => {
            if (output.usedIds) markUsed.mutate(output.usedIds);
            showToast("クリップボードにテキストをコピーしました");
            setOutput(null);
          }}
        />
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4 pb-safe">
          <p className="rounded-full bg-[var(--text)] px-5 py-2.5 text-sm font-medium text-[var(--bg)] shadow-[var(--shadow-pop)]">{toast}</p>
        </div>
      )}
    </div>
  );
}

function FlavorCard({
  flavor: f,
  simple,
  onOutput,
  onInstantCopy,
  onEdit,
  onDuplicate,
  onJson,
  onDelete,
  onCancelJob,
}: {
  flavor: Flavor;
  simple: boolean;
  onOutput: () => void;
  onInstantCopy?: () => Promise<boolean>;
  onEdit: () => void;
  onDuplicate: () => void;
  onJson: () => void;
  onDelete: () => void;
  onCancelJob: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleSimpleCopy() {
    if (onInstantCopy) {
      const ok = await onInstantCopy();
      if (ok) {
        setCopied(true);
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 2000);
      }
    } else {
      onOutput();
    }
  }

  if (simple) {
    return (
      <article className="flex items-center gap-2 rounded-3xl bg-[var(--surface)] px-4 py-2 shadow-[var(--shadow-card)]">
        <h3 className="min-w-0 flex-1 truncate text-sm font-bold leading-snug text-[var(--text)]">
          {f.name}
        </h3>
        <button
          type="button"
          onClick={onEdit}
          disabled={f.locked}
          aria-label={`${f.name} を編集`}
          className="min-h-9 shrink-0 rounded-full bg-[var(--surface-alt)] px-3.5 text-xs font-medium text-[var(--text)] disabled:opacity-40"
        >
          編集
        </button>
        <button
          type="button"
          onClick={handleSimpleCopy}
          disabled={f.locked}
          aria-label={`${f.name} をコピー`}
          className="min-h-9 shrink-0 rounded-full bg-[var(--accent)] px-3.5 text-xs font-bold text-[var(--accent-text)] hover:bg-[var(--accent-hover)] disabled:opacity-40"
        >
          {copied ? "コピー済み" : "コピー"}
        </button>
      </article>
    );
  }
  return (
    <article className="rounded-3xl bg-[var(--surface)] px-4 py-3.5 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-base font-bold leading-snug text-[var(--text)]">
          {f.name}
        </h3>
        <span className="shrink-0 text-sm font-medium text-[var(--text)]">{f.influence}%</span>
      </div>

      <div
        className="mt-2 h-2.5 overflow-hidden rounded-full bg-[var(--surface-alt)]"
        role="img"
        aria-label={`影響度 ${f.influence}%: ${influenceTierText(f.influence, f.ignoreCharacterSettings)}`}
      >
        <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--gold),var(--accent))]" style={{ width: `${f.influence}%` }} />
      </div>

      {(f.typeNames.length > 0 ||
        f.summary ||
        f.ignoreCharacterSettings ||
        f.locked ||
        f.lastUsedAt) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {f.ignoreCharacterSettings && (
            <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-bold leading-none text-[var(--accent-hover)]">
              キャラ設定を無視
            </span>
          )}
          {f.typeNames.map((n) => (
            <span
              key={n}
              className="rounded-full bg-[var(--surface-alt)] px-2.5 py-1 text-xs font-medium leading-none text-[var(--text)]"
            >
              {n}
            </span>
          ))}
          {f.summary && (
            <span className="min-w-0 flex-1 truncate text-xs text-[var(--dim)]">{f.summary}</span>
          )}
          {f.locked && (
            <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-bold text-[var(--accent)]">
              {f.activeJobStatus === "processing" ? "AI生成中" : "AI生成待ち"}
            </span>
          )}
          {f.lastUsedAt && (
            <span className="ml-auto text-xs text-[var(--dim)]">{formatDateTime(f.lastUsedAt)}</span>
          )}
        </div>
      )}

      {f.locked ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={onCancelJob}
            className="min-h-9 rounded-full bg-[var(--danger-soft)] px-3.5 text-xs font-bold text-[var(--danger)]"
          >
            生成をキャンセル
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            className="min-h-9 rounded-full bg-[var(--surface-alt)] px-3.5 text-xs font-medium text-[var(--text)]"
          >
            編集
          </button>
          <button
            type="button"
            onClick={onOutput}
            className="min-h-9 rounded-full bg-[var(--accent)] px-4 text-xs font-bold text-[var(--accent-text)] hover:bg-[var(--accent-hover)]"
          >
            コピー
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            className="min-h-9 rounded-full bg-[var(--surface-alt)] px-3.5 text-xs font-medium text-[var(--text)]"
          >
            複製
          </button>
          <button
            type="button"
            onClick={onJson}
            className="min-h-9 rounded-full bg-[var(--surface-alt)] px-3.5 text-xs font-medium text-[var(--text)]"
          >
            JSON
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="min-h-9 rounded-full px-3 text-xs font-medium text-[var(--danger)]"
          >
            削除
          </button>
        </div>
      )}
    </article>
  );
}

function FolderList(props: {
  flavors: Flavor[];
  types: FlavorType[];
  simple: boolean;
  onOutput: (f: Flavor) => void;
  onInstantCopy?: (f: Flavor) => Promise<boolean>;
  onEdit: (f: Flavor) => void;
  onDuplicate: (f: Flavor) => void;
  onJson: (f: Flavor) => void;
  onDelete: (f: Flavor) => void;
  onCancelJob: (f: Flavor) => void;
}) {
  const groups: { id: string; name: string; items: Flavor[] }[] = [
    ...props.types.map((t) => ({
      id: t.id,
      name: t.name,
      items: props.flavors.filter((f) => f.typeIds.includes(t.id)),
    })),
    {
      id: "__none__",
      name: "無分類",
      items: props.flavors.filter((f) => f.typeIds.length === 0),
    },
  ];
  return (
    <div className="mt-3 space-y-4">
      {groups.map((g) => (
        <section key={g.id} aria-label={`フォルダ ${g.name}`}>
          <h3 className="text-base font-bold text-[var(--text)]">
            {g.name} <span className="text-sm font-normal text-[var(--dim)]">（{g.items.length}件）</span>
          </h3>
          {g.items.length === 0 ? (
            <p className="mt-1 text-sm text-[var(--dim)]">なし</p>
          ) : (
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {g.items.map((f) => (
                <FlavorCard
                  key={`${g.id}:${f.id}`}
                  flavor={f}
                  simple={props.simple}
                  onOutput={() => props.onOutput(f)}
                  onInstantCopy={props.onInstantCopy ? () => props.onInstantCopy!(f) : undefined}
                  onEdit={() => props.onEdit(f)}
                  onDuplicate={() => props.onDuplicate(f)}
                  onJson={() => props.onJson(f)}
                  onDelete={() => props.onDelete(f)}
                  onCancelJob={() => props.onCancelJob(f)}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function OutputModal({
  output,
  onClose,
  onCopied,
}: {
  output: OutputState;
  onClose: () => void;
  onCopied: () => void;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(output.text);
      ok = true;
    } catch {
      const el = areaRef.current;
      if (el) {
        el.focus();
        el.select();
        try {
          ok = document.execCommand("copy");
        } catch {
          ok = false;
        }
      }
    }
    if (ok) onCopied();
    else setCopyError("コピーできませんでした。テキストを選択して手動でコピーしてください。");
  }

  function download() {
    const blob = new Blob([output.text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "flavors.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <Overlay title={output.title} onClose={onClose}>
      <textarea
        ref={areaRef}
        readOnly
        aria-label="出力テキスト"
        value={output.text}
        rows={12}
        className="w-full rounded-3xl border-2 border-transparent bg-[var(--surface-alt)] p-4 font-mono text-sm text-[var(--text)]"
      />
      <p className="mt-2 text-xs text-[var(--dim)]">{output.text.length} 文字（目安）</p>
      {output.isJson && (
        <p className="mt-1 text-xs text-[var(--dim)]">※ このJSONは受け渡し用です。</p>
      )}
      {copyError && <p className="mt-2 text-sm text-[var(--danger)]">{copyError}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={copy}
          className="flex-1 rounded-full bg-[var(--accent)] py-2.5 font-bold text-[var(--accent-text)] shadow-[var(--shadow-card)] hover:bg-[var(--accent-hover)]"
        >
          コピー
        </button>
        {output.isJson && (
          <button
            type="button"
            onClick={download}
            className="rounded-full bg-[var(--surface-alt)] px-5 text-sm font-medium text-[var(--text)]"
          >
            ダウンロード
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-[var(--surface-alt)] px-5 text-sm font-medium text-[var(--text)]"
        >
          閉じる
        </button>
      </div>
    </Overlay>
  );
}

function TypesView({
  types,
  onBack,
  onDeleteType,
  showToast,
}: {
  types: FlavorType[];
  onBack: () => void;
  onDeleteType: (t: FlavorType) => void;
  showToast: (m: string) => void;
}) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [defs, setDefs] = useState<{ label: string; role: Role }[]>([]);
  const [originalName, setOriginalName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const payload = { name: name.trim(), defaultFields: defs };
      if (editingId) return api.updateType({ id: editingId, ...payload });
      return api.createType(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["state"] });
      setEditingId(null);
      setName("");
      setDefs([]);
      setError(null);
      showToast("カテゴリを保存しました");
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  function startEdit(t: FlavorType) {
    setEditingId(t.id);
    setName(t.name);
    setOriginalName(t.name);
    setDefs(t.defaultFields.map((d) => ({ ...d })));
    setError(null);
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-10">
      <div className="flex items-center gap-2 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="一覧へ戻る"
          className="rounded-full bg-[var(--surface)] px-4 text-sm font-medium text-[var(--text)] shadow-[var(--shadow-card)]"
        >
          ← 一覧
        </button>
        <h2 className="text-lg font-bold text-[var(--text)]">カテゴリ管理</h2>
      </div>

      <div className="space-y-2">
        {types.map((t) => (
          <div
            key={t.id}
            className="flex flex-wrap items-center gap-2 rounded-3xl bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow-card)]"
          >
            <span className="font-medium text-[var(--text)]">{t.name}</span>
            <span className="text-xs text-[var(--dim)]">
              使用中 {t.flavorCount} 件
              {t.defaultFields.length > 0 &&
                ` / デフォルト項目: ${t.defaultFields.map((d) => d.label).join("、")}`}
            </span>
            <span className="ml-auto flex gap-1">
              <button
                type="button"
                onClick={() => startEdit(t)}
                className="rounded px-2 text-sm text-[var(--accent)]"
                aria-label={`カテゴリ ${t.name} を編集`}
              >
                編集
              </button>
              <button
                type="button"
                onClick={() => onDeleteType(t)}
                className="rounded px-2 text-sm text-[var(--danger)]"
                aria-label={`カテゴリ ${t.name} を削除`}
              >
                削除
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-3xl bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
        <h3 className="text-sm font-medium text-[var(--text)]">
          {editingId ? "カテゴリを編集" : "カテゴリを追加"}
        </h3>
        <label htmlFor="type-name" className="mt-3 mb-1 block text-sm text-[var(--text)]">
          カテゴリ名
        </label>
        <input
          id="type-name"
          {...FIELDS.createType.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-2xl border-2 border-transparent bg-[var(--surface-alt)] px-4 py-2.5 text-base text-[var(--text)]"
        />
        {editingId && name.trim() !== originalName && (
          <p className="mt-1 text-xs text-[var(--danger)]">
            注意: 改名すると、過去に出力したJSON（カテゴリ名で照合）と一致しなくなります。
          </p>
        )}
        <span className="mt-4 mb-1 block text-sm text-[var(--text)]">デフォルト項目</span>
        <div className="space-y-2">
          {defs.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                aria-label={`デフォルト項目 ${i + 1} の項目名`}
                value={d.label}
                onChange={(e) => setDefs(defs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                placeholder="項目名"
                className="min-w-0 flex-1 rounded-xl border-2 border-transparent bg-[var(--surface-alt)] px-3 py-1 text-sm text-[var(--text)]"
              />
              <select
                aria-label={`デフォルト項目 ${i + 1} の役割`}
                value={d.role}
                onChange={(e) =>
                  setDefs(defs.map((x, j) => (j === i ? { ...x, role: e.target.value as Role } : x)))
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
                aria-label={`デフォルト項目 ${i + 1} を削除`}
                onClick={() => setDefs(defs.filter((_, j) => j !== i))}
                className="px-2 text-sm text-[var(--danger)]"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          disabled={defs.length >= 20}
          onClick={() => setDefs([...defs, { label: "", role: "事実" as Role }])}
          className="mt-2 rounded-full bg-[var(--surface-alt)] px-4 text-sm font-medium text-[var(--text)] disabled:opacity-40"
        >
          ＋ デフォルト項目を追加
        </button>
        {error && (
          <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={!name.trim() || save.isPending}
            onClick={() => save.mutate()}
            className="rounded-full bg-[var(--accent)] px-6 font-bold text-[var(--accent-text)] shadow-[var(--shadow-card)] hover:bg-[var(--accent-hover)] disabled:opacity-40"
          >
            {save.isPending ? "保存中…" : "保存する"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setName("");
                setDefs([]);
                setError(null);
              }}
              className="rounded-full bg-[var(--surface-alt)] px-5 text-sm font-medium text-[var(--text)]"
            >
              編集をやめる
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-[var(--dim)]">
          デフォルト項目の変更は既存のフレーバーには反映されません（作成・編集中の補充にのみ効きます）。
        </p>
      </div>
    </main>
  );
}

function HistoryView({
  jobs,
  onBack,
  onCancelJob,
}: {
  jobs: Job[];
  onBack: () => void;
  onCancelJob: (job: Job) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-10">
      <div className="flex items-center gap-2 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="一覧へ戻る"
          className="rounded-full bg-[var(--surface)] px-4 text-sm font-medium text-[var(--text)] shadow-[var(--shadow-card)]"
        >
          ← 一覧
        </button>
        <h2 className="text-lg font-bold text-[var(--text)]">自動生成履歴</h2>
      </div>
      {jobs.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--dim)]">履歴はまだありません。</p>
      ) : (
        <div className="space-y-2">
          {jobs.map((j) => (
            <article key={j.id} className="rounded-3xl bg-[var(--surface)] p-4 shadow-[var(--shadow-card)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-[var(--text)]">{j.flavorName}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    j.status === "done"
                      ? "bg-[var(--gold)] text-white dark:text-[#2b2135]"
                      : j.status === "failed"
                        ? "bg-[var(--danger)] text-white"
                        : j.status === "cancelled"
                          ? "bg-[var(--surface-alt)] text-[var(--dim)]"
                          : "bg-[var(--accent)] text-[var(--accent-text)]"
                  }`}
                >
                  {STATUS_LABEL[j.status] ?? j.status}
                </span>
                <span className="text-xs text-[var(--dim)]">投入: {formatDateTime(j.createdAt)}</span>
                {j.finishedAt && (
                  <span className="text-xs text-[var(--dim)]">完了: {formatDateTime(j.finishedAt)}</span>
                )}
              </div>
              {j.error && <p className="mt-1 text-sm text-[var(--danger)]">失敗理由: {j.error}</p>}
              <p className="mt-1 text-xs text-[var(--dim)]">
                元の文脈を考慮: {j.considerContext ? "オン" : "オフ"}
                {j.requestText && ` / 方針リクエスト: ${j.requestText}`}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpenId(openId === j.id ? null : j.id)}
                  className="rounded-full bg-[var(--surface-alt)] px-4 text-sm font-medium text-[var(--text)]"
                  aria-expanded={openId === j.id}
                >
                  {openId === j.id ? "詳細を閉じる" : "詳細を見る"}
                </button>
                {(j.status === "queued" || j.status === "processing") && (
                  <button
                    type="button"
                    onClick={() => onCancelJob(j)}
                    className="rounded-full bg-[var(--danger-soft)] px-4 text-sm font-bold text-[var(--danger)]"
                  >
                    キャンセル
                  </button>
                )}
              </div>
              {openId === j.id && (
                <div className="mt-3 space-y-3">
                  <SnapshotBlock title="投入時点の全項目" json={j.fullSnapshot} />
                  <SnapshotBlock title="土台として渡した項目" json={j.baseSnapshot} />
                  {j.status === "cancelled" ? (
                    <p className="text-sm text-[var(--dim)]">生成結果は破棄され、代入されませんでした。</p>
                  ) : j.resultSnapshot ? (
                    <SnapshotBlock title="生成結果（反映した内容）" json={j.resultSnapshot} />
                  ) : null}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

function SnapshotBlock({ title, json }: { title: string; json: string }) {
  let pretty = json;
  try {
    pretty = JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    // keep raw
  }
  return (
    <div>
      <h4 className="text-xs font-medium text-[var(--dim)]">{title}</h4>
      <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-2xl bg-[var(--surface-alt)] p-3 text-xs text-[var(--text)]">
        {pretty}
      </pre>
    </div>
  );
}

function ImportView({ onBack, showToast }: { onBack: () => void; showToast: (m: string) => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const result = useRef<ApiResponse<typeof api, "importJson"> | null>(null);
  const [, force] = useState(0);

  const imp = useMutation({
    mutationFn: (json: string) => api.importJson({ json }),
    onSuccess: (r) => {
      result.current = r;
      force((x) => x + 1);
      queryClient.invalidateQueries({ queryKey: ["state"] });
      if (!r.fatalError) showToast(`${r.importedCount} 件を取り込みました`);
    },
    onError: (e) => showToast(e instanceof Error ? e.message : String(e)),
  });

  const r = result.current;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-10">
      <div className="flex items-center gap-2 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="一覧へ戻る"
          className="rounded-full bg-[var(--surface)] px-4 text-sm font-medium text-[var(--text)] shadow-[var(--shadow-card)]"
        >
          ← 一覧
        </button>
        <h2 className="text-lg font-bold text-[var(--text)]">JSON取り込み</h2>
      </div>
      <p className="text-sm leading-relaxed text-[var(--dim)]">
        flavor-export / 1.0 形式のJSONを取り込みます。構文エラーや形式違いの場合は全体エラーとして1件も登録しません。形式が正しい場合はフレーバー単位で検証し、正常なものだけ登録します。未登録のカテゴリ名は自動でカテゴリマスタへ追加されます。同名のフレーバーがあっても上書きせず別件として登録します。
      </p>
      <textarea
        aria-label="取り込むJSON"
        {...FIELDS.importJson.json}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        placeholder='{"format": "flavor-export", "format_version": "1.0", "flavors": [...]}'
        className="mt-3 w-full rounded-3xl border-2 border-transparent bg-[var(--surface)] p-4 font-mono text-sm text-[var(--text)] shadow-[var(--shadow-card)]"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          aria-label="JSONファイルを選ぶ"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => setText(String(reader.result));
            reader.readAsText(file);
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-full bg-[var(--surface)] px-5 text-sm font-medium text-[var(--text)] shadow-[var(--shadow-card)]"
        >
          ファイルを選ぶ
        </button>
        <button
          type="button"
          disabled={!text.trim() || imp.isPending}
          onClick={() => imp.mutate(text)}
          className="rounded-full bg-[var(--accent)] px-6 font-bold text-[var(--accent-text)] shadow-[var(--shadow-card)] hover:bg-[var(--accent-hover)] disabled:opacity-40"
        >
          {imp.isPending ? "取り込み中…" : "取り込む"}
        </button>
      </div>
      {r && (
        <div className="mt-5 rounded-3xl bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
          <h3 className="text-sm font-medium text-[var(--text)]">取り込み結果</h3>
          {r.fatalError ? (
            <p className="mt-2 text-sm text-[var(--danger)]">{r.fatalError}</p>
          ) : (
            <>
              <p className="mt-2 text-sm text-[var(--text)]">登録成功: {r.importedCount} 件</p>
              {r.addedTypes.length > 0 && (
                <p className="mt-1 text-sm text-[var(--text)]">
                  自動追加されたカテゴリ: {r.addedTypes.join("、")}
                </p>
              )}
              {r.errors.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-[var(--danger)]">
                  {r.errors.map((e, i) => (
                    <li key={i}>
                      {e.index + 1}件目{e.name ? `「${e.name}」` : ""}: {e.reason}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </main>
  );
}
