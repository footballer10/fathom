import { useCallback, useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";
import {
  APP_NAME,
  QUESTIONS_PER_DAY,
  TIERS,
  WEEKLY_UNLIMITED_QUESTIONS,
  normalizePrompt,
  parsePlainText,
  tierInfo,
  validateQuestions,
} from "@fathom/shared";
import type { ParsedFixes, ParsedQuestion, QuestionReport, TierPoints } from "@fathom/shared";
import { navigate } from "../router";
import { AdminError, admin, getToken, setToken } from "./adminApi";
import type { AdminStatus, ScheduleDay } from "./adminApi";

type Tab = "import" | "generate" | "schedule" | "review" | "pool";
const TABS: { id: Tab; label: string }[] = [
  { id: "import", label: "Import" },
  { id: "generate", label: "Generate" },
  { id: "schedule", label: "Schedule" },
  { id: "review", label: "Review" },
  { id: "pool", label: "Pool" },
];

export function AdminPortal() {
  const [token, setTok] = useState(getToken());
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => (location.hash.slice(1) as Tab) || "import");
  const [importText, setImportText] = useState("");

  const refresh = useCallback(async () => {
    try {
      setStatus(await admin<AdminStatus>("/api/admin/status"));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof AdminError && err.status === 401) {
        setToken("");
        setTok("");
      }
    }
  }, []);

  useEffect(() => {
    if (token) void refresh();
  }, [token, refresh]);

  useEffect(() => {
    history.replaceState(null, "", `#${tab}`);
  }, [tab]);

  if (!token) return <Login onLogin={(t) => (setToken(t), setTok(t))} error={error} />;

  return (
    <div className="admin">
      <header className="admin-head">
        <div>
          <h1>{APP_NAME} admin</h1>
          {status && (
            <p className="muted small">
              Today {status.today} · {status.filledDaysAhead} days filled ahead · Unlimited pool {status.poolSize}/{status.poolCap} ·{" "}
              {status.reserveCount} reserve · {status.totalQuestions} questions total
            </p>
          )}
        </div>
        <div className="admin-head-actions">
          <button className="btn btn--ghost" onClick={() => navigate("/")}>
            Back to game
          </button>
          <button className="btn btn--ghost" onClick={() => (setToken(""), setTok(""))}>
            Log out
          </button>
        </div>
      </header>
      {status && status.filledDaysAhead < QUESTIONS_PER_DAY && (
        <div className="admin-banner">
          Only {status.filledDaysAhead} future day(s) are fully scheduled. Run the weekly task, or use the Generate tab, to add more.
        </div>
      )}
      {error && <div className="admin-banner admin-banner--error">{error}</div>}
      <nav className="admin-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`admin-tab${tab === t.id ? " admin-tab--on" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <section className="admin-body">
        {tab === "import" && <ImportTab status={status} text={importText} setText={setImportText} onDone={refresh} />}
        {tab === "generate" && <GenerateTab />}
        {tab === "schedule" && (
          <ScheduleTab
            onEdit={(text) => {
              setImportText(text);
              setTab("import");
            }}
            onChanged={refresh}
          />
        )}
        {tab === "review" && <ReviewTab onPasteFixes={() => setTab("import")} />}
        {tab === "pool" && <PoolTab onChanged={refresh} />}
      </section>
    </div>
  );
}

function Login({ onLogin, error }: { onLogin: (t: string) => void; error: string | null }) {
  const [value, setValue] = useState("");
  return (
    <div className="admin admin-login">
      <div className="card">
        <h2>Admin</h2>
        <p className="muted small">Enter your ADMIN_TOKEN. It's saved in this browser only.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) onLogin(value.trim());
          }}
        >
          <input className="admin-input" type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Admin token" autoFocus />
          <button className="btn btn--primary" type="submit">
            Log in
          </button>
        </form>
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

type Mode = "file" | "fill" | "unlimited";

function tierCounts(q: ParsedQuestion) {
  const c = new Map<TierPoints, number>();
  for (const a of q.answers) c.set(a.tier, (c.get(a.tier) ?? 0) + 1);
  return TIERS.map((t) => `${t.emoji}${c.get(t.points) ?? 0}`).join(" ");
}

function ImportTab({
  status,
  text,
  setText,
  onDone,
}: {
  status: AdminStatus | null;
  text: string;
  setText: (t: string) => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>("file");
  const [replace, setReplace] = useState(false);
  const [checked, setChecked] = useState<{
    questions: ParsedQuestion[];
    fixes: ParsedFixes[];
    parseErrors: { line: number; message: string }[];
    reports: QuestionReport[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const check = () => {
    const parsed = parsePlainText(text);
    const existingPrompts = new Map((status?.prompts ?? []).map((p) => [normalizePrompt(p.prompt), p.id]));
    const takenSlots = new Map((status?.scheduled ?? []).map((s) => [`${s.date}#${s.slot}`, s.id]));
    const result = validateQuestions(
      parsed.questions.map((q) => ({ ...q, date: mode === "file" ? q.date : undefined, slot: mode === "file" ? q.slot : undefined })),
      { existingPrompts, takenSlots, replace },
    );
    setChecked({ questions: parsed.questions, fixes: parsed.fixes, parseErrors: parsed.errors, reports: result.reports });
    setLog([]);
  };

  const errorCount = checked ? checked.parseErrors.length + checked.reports.reduce((n, r) => n + r.errors.length, 0) : 0;
  const canImport = !!checked && errorCount === 0 && (checked.questions.length > 0 || checked.fixes.length > 0) && !busy;

  const runImport = async () => {
    if (!checked) return;
    setBusy(true);
    const lines: string[] = [];
    const push = (l: string) => {
      lines.push(l);
      setLog([...lines]);
    };
    for (const q of checked.questions) {
      try {
        const r = await admin<{ ok: boolean; id?: string; status?: string; date?: string; slot?: number; errors?: string[] }>(
          "/api/admin/question",
          { body: { question: q, mode, replace, source: "paste" } },
        );
        push(r.ok ? `✓ ${r.id} ${q.prompt} → ${r.status}${r.date ? ` ${r.date} slot ${r.slot}` : ""}` : `✗ ${q.prompt}: ${(r.errors ?? []).join("; ")}`);
      } catch (err) {
        push(`✗ ${q.prompt}: ${(err as Error).message}`);
      }
    }
    for (const f of checked.fixes) {
      try {
        const r = await admin<{ ok: boolean; errors?: string[] }>("/api/admin/fixes", { body: { fixes: f } });
        push(r.ok ? `✓ FIXES ${f.questionId}` : `✗ FIXES ${f.questionId}: ${(r.errors ?? []).join("; ")}`);
      } catch (err) {
        push(`✗ FIXES ${f.questionId}: ${(err as Error).message}`);
      }
    }
    setBusy(false);
    setChecked(null);
    onDone();
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) setText(await file.text());
  };

  return (
    <div className="admin-import">
      <p className="muted small">
        Paste questions or FIXES blocks in the plain-text format (or drop a .txt file on the box). Click <b>Check</b>, fix anything in red,
        then <b>Import</b>.
      </p>
      <textarea
        className="admin-textarea"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setChecked(null);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        placeholder={"# QUESTION\ndate: 2026-11-02\nslot: 1\ncategory: food\nprompt: Name a fruit\n\n[One in a Krillion]\n..."}
        spellCheck={false}
      />
      <div className="admin-row">
        <label>
          <input type="radio" checked={mode === "file"} onChange={() => setMode("file")} /> Use dates in the file
        </label>
        <label>
          <input type="radio" checked={mode === "fill"} onChange={() => setMode("fill")} /> Fill the next open dates
        </label>
        <label>
          <input type="radio" checked={mode === "unlimited"} onChange={() => setMode("unlimited")} /> Add all to Unlimited
        </label>
        <label>
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace questions already in those slots
        </label>
      </div>
      <div className="admin-row">
        <button className="btn" onClick={check} disabled={!text.trim() || busy}>
          Check
        </button>
        <button className="btn btn--primary" onClick={() => void runImport()} disabled={!canImport}>
          {busy ? "Importing…" : "Import"}
        </button>
        {checked && (
          <span className={errorCount ? "error-text" : "muted"}>
            {checked.questions.length} question(s), {checked.fixes.length} FIXES block(s), {errorCount} error(s)
          </span>
        )}
      </div>
      {log.length > 0 && <pre className="admin-log">{log.join("\n")}</pre>}
      {checked && (
        <div className="admin-preview">
          {checked.parseErrors.map((e, i) => (
            <div key={i} className="admin-issue admin-issue--error">
              Line {e.line}: {e.message}
            </div>
          ))}
          {checked.questions.map((q, i) => {
            const r = checked.reports[i];
            return (
              <div key={i} className={`admin-q${r.errors.length ? " admin-q--bad" : ""}`}>
                <div className="admin-q-head">
                  <b>{q.prompt || "(no prompt)"}</b>
                  <span className="muted small">
                    {q.id ? `${q.id} · ` : ""}
                    {q.category} · {mode === "file" ? (q.date ? `${q.date} slot ${q.slot}` : q.pool ?? "unlimited") : mode} · {q.answers.length} answers ·{" "}
                    {tierCounts(q)}
                  </span>
                </div>
                {r.errors.map((e, j) => (
                  <div key={j} className="admin-issue admin-issue--error">
                    {e}
                  </div>
                ))}
                {r.warnings.map((w, j) => (
                  <div key={j} className="admin-issue admin-issue--warn">
                    {w}
                  </div>
                ))}
              </div>
            );
          })}
          {checked.fixes.map((f, i) => (
            <div key={`f${i}`} className="admin-q">
              <div className="admin-q-head">
                <b>FIXES for {f.questionId}</b>
                <span className="muted small">
                  {f.aliases.length} alias line(s), {f.adds.length} new answer(s), {f.rejects.length} reject(s)
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

function GenerateTab() {
  const [days, setDays] = useState(7);
  const [unlimited, setUnlimited] = useState(WEEKLY_UNLIMITED_QUESTIONS);
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const build = async () => {
    setBusy(true);
    try {
      setPrompt(await admin<string>(`/api/admin/generate-prompt?days=${days}&unlimited=${unlimited}`, { text: true }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="muted small">
        Builds a prompt for a normal Claude chat. Paste it in; Claude writes one batch per reply. Say "next" to keep going, paste each reply into the
        Import tab, and Check + Import. (The weekly scheduled task does all of this automatically.)
      </p>
      <div className="admin-row">
        <label>
          Daily days to fill{" "}
          <input className="admin-num" type="number" min={1} max={14} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </label>
        <label>
          Extra Unlimited questions{" "}
          <input className="admin-num" type="number" min={0} max={200} value={unlimited} onChange={(e) => setUnlimited(Number(e.target.value))} />
        </label>
        <button className="btn btn--primary" onClick={() => void build()} disabled={busy}>
          {busy ? "Building…" : "Build prompt"}
        </button>
        {prompt && (
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard.writeText(prompt);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        )}
      </div>
      {prompt && <textarea className="admin-textarea admin-textarea--tall" value={prompt} readOnly />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

function ScheduleTab({ onEdit, onChanged }: { onEdit: (text: string) => void; onChanged: () => void }) {
  const [days, setDays] = useState<ScheduleDay[]>([]);
  const [picked, setPicked] = useState<{ date: string; slot: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => setDays(await admin<ScheduleDay[]>("/api/admin/schedule?days=21")), []);
  useEffect(() => {
    void load();
  }, [load]);

  const filled = days.filter((d) => d.slots.every(Boolean)).length;

  const edit = async (id: string) => {
    const r = await admin<{ text: string }>(`/api/admin/question/${id}`);
    onEdit(r.text);
  };
  const addAt = (date: string, slot: number) =>
    onEdit(`# QUESTION\ndate: ${date}\nslot: ${slot}\ncategory: \nprompt: \n\n[One in a Krillion]\n\n[Deep Cut]\n\n[Rare]\n\n[Schooler]\n\n[Too Clever]\n\n[Plankton]\n`);
  const del = async (id: string, prompt: string) => {
    if (!confirm(`Remove "${prompt}"? (Questions that were already played are retired instead of deleted.)`)) return;
    await admin(`/api/admin/question/${id}`, { method: "DELETE" });
    await load();
    onChanged();
  };
  const unschedule = async (id: string) => {
    await admin("/api/admin/unschedule", { body: { id } });
    await load();
    onChanged();
  };
  const pick = async (date: string, slot: number) => {
    if (!picked) {
      setPicked({ date, slot });
      setMsg("Now click another slot to swap with.");
      return;
    }
    if (picked.date !== date || picked.slot !== slot) {
      await admin("/api/admin/swap", { body: { a: picked, b: { date, slot } } });
      await load();
      onChanged();
    }
    setPicked(null);
    setMsg(null);
  };

  return (
    <div>
      {filled < QUESTIONS_PER_DAY && <div className="admin-banner">Only {filled} of the next 21 days are fully filled.</div>}
      {msg && <p className="muted small">{msg}</p>}
      <div className="admin-schedule">
        {days.map((d) => (
          <div key={d.date} className="admin-day">
            <div className="admin-day-head">
              <b>{d.date}</b> <span className="muted small">{d.slots.filter(Boolean).length}/7</span>
            </div>
            {d.slots.map((s, i) => (
              <div key={i} className={`admin-slot${s ? "" : " admin-slot--empty"}${picked?.date === d.date && picked.slot === i + 1 ? " admin-slot--picked" : ""}`}>
                <span className="admin-slot-n">{i + 1}</span>
                {s ? (
                  <>
                    <span className="admin-slot-prompt" title={s.id}>
                      {s.prompt} <span className="muted small">({s.category})</span>
                    </span>
                    <span className="admin-slot-actions">
                      <button className="link-btn" onClick={() => void edit(s.id)}>
                        Edit
                      </button>
                      <button className="link-btn" onClick={() => void pick(d.date, i + 1)}>
                        Swap
                      </button>
                      <button className="link-btn" onClick={() => void unschedule(s.id)}>
                        To Unlimited
                      </button>
                      <button className="link-btn" onClick={() => void del(s.id, s.prompt)}>
                        Delete
                      </button>
                    </span>
                  </>
                ) : (
                  <span className="admin-slot-actions">
                    <span className="muted small">empty</span>
                    <button className="link-btn" onClick={() => addAt(d.date, i + 1)}>
                      Add
                    </button>
                    {picked && (
                      <button className="link-btn" onClick={() => void pick(d.date, i + 1)}>
                        Move here
                      </button>
                    )}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

interface Review {
  rejected: { questionId: string; prompt: string; guess: string; count: number; closest: string | null; distance: number | null }[];
  reports: { id: number; questionId: string; prompt: string; guess: string; at: number }[];
}

function ReviewTab({ onPasteFixes }: { onPasteFixes: () => void }) {
  const [data, setData] = useState<Review | null>(null);
  const [copied, setCopied] = useState(false);
  const load = useCallback(async () => setData(await admin<Review>("/api/admin/review")), []);
  useEffect(() => {
    void load();
  }, [load]);

  const copy = async () => {
    const text = await admin<string>("/api/admin/rejected-export", { text: true });
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      <p className="muted small">
        Every guess that wasn't accepted since the last review, from every mode. Click <b>Copy export for Claude</b>, paste it into a normal Claude chat, then
        paste Claude's FIXES reply into the{" "}
        <button className="link-btn" onClick={onPasteFixes}>
          Import tab
        </button>
        .
      </p>
      <div className="admin-row">
        <button className="btn btn--primary" onClick={() => void copy()}>
          {copied ? "Copied!" : "Copy export for Claude"}
        </button>
      </div>
      {data && (
        <div className="admin-cols">
          <div>
            <h3>Reports ({data.reports.length})</h3>
            <table className="admin-table">
              <tbody>
                {data.reports.map((r) => (
                  <tr key={r.id}>
                    <td>{r.questionId}</td>
                    <td>{r.prompt}</td>
                    <td>
                      <b>{r.guess}</b>
                    </td>
                    <td>
                      <button
                        className="link-btn"
                        onClick={async () => {
                          await admin(`/api/admin/reports/${r.id}/resolve`, { method: "POST", body: {} });
                          await load();
                        }}
                      >
                        Dismiss
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3>Rejected guesses ({data.rejected.length})</h3>
            <table className="admin-table">
              <tbody>
                {data.rejected.map((r, i) => (
                  <tr key={i}>
                    <td>{r.questionId}</td>
                    <td>{r.prompt}</td>
                    <td>
                      <b>{r.guess}</b> ×{r.count}
                    </td>
                    <td className="muted small">{r.closest ? `≈ ${r.closest} (${r.distance})` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

interface PoolData {
  poolSize: number;
  cap: number;
  active: { id: string; prompt: string; category: string; plays: number; answer_count: number; hitRate: number | null; avgPoints: number | null }[];
  retired: { id: string; prompt: string; category: string; plays: number; retired_at: number }[];
}

interface Retier {
  id: string;
  prompt: string;
  plays: number;
  suggestions: { answerId: string; text: string; current: TierPoints; suggested: TierPoints; share: number }[];
}

function PoolTab({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<PoolData | null>(null);
  const [retier, setRetier] = useState<Retier[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const load = useCallback(async () => {
    setData(await admin<PoolData>("/api/admin/pool"));
    setRetier(await admin<Retier[]>("/api/admin/retier"));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    const r = await admin<{ before: number; after: number; retired: number; restored: number; cap: number }>("/api/admin/pool-refresh", {
      method: "POST",
      body: {},
    });
    setMsg(`Pool ${r.before} → ${r.after} (cap ${r.cap}): retired ${r.retired}, restored ${r.restored}.`);
    await load();
    onChanged();
  };

  const rows = useMemo(
    () => (data?.active ?? []).filter((q) => !filter || q.prompt.toLowerCase().includes(filter.toLowerCase()) || q.category.includes(filter)),
    [data, filter],
  );

  return (
    <div>
      {data && (
        <div className="admin-row">
          <b>
            Unlimited pool: {data.poolSize} / {data.cap}
          </b>
          <span className="muted">{data.retired.length} retired</span>
          <button className="btn" onClick={() => void refresh()}>
            Refresh pool now
          </button>
          {msg && <span className="muted small">{msg}</span>}
        </div>
      )}
      {retier.length > 0 && (
        <div className="card admin-retier">
          <h3>Re-tiering suggestions (questions with 300+ plays)</h3>
          {retier.map((q) => (
            <div key={q.id}>
              <b>
                {q.id} {q.prompt}
              </b>{" "}
              <span className="muted small">({q.plays} plays)</span>
              <ul>
                {q.suggestions.map((s) => (
                  <li key={s.answerId}>
                    {s.text}: {tierInfo(s.current).name} → <b>{tierInfo(s.suggested).name}</b> <span className="muted small">({s.share}% of answers)</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="muted small">To apply, edit the question (Schedule tab or Import with its id:) and move the answers.</p>
        </div>
      )}
      <input className="admin-input" placeholder="Filter by prompt or category" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <table className="admin-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Prompt</th>
            <th>Category</th>
            <th>Answers</th>
            <th>Plays</th>
            <th>Hit rate</th>
            <th>Avg pts</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((q) => (
            <tr key={q.id}>
              <td>{q.id}</td>
              <td>{q.prompt}</td>
              <td>{q.category}</td>
              <td>{q.answer_count}</td>
              <td>{q.plays}</td>
              <td>{q.hitRate === null ? "—" : `${q.hitRate}%`}</td>
              <td>{q.avgPoints ?? "—"}</td>
              <td>
                <button
                  className="link-btn"
                  onClick={async () => {
                    const r = await admin<{ text: string }>(`/api/admin/question/${q.id}`);
                    const blob = new Blob([r.text], { type: "text/plain" });
                    window.open(URL.createObjectURL(blob), "_blank");
                  }}
                >
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data && data.retired.length > 0 && (
        <>
          <h3>Retired ({data.retired.length})</h3>
          <table className="admin-table">
            <tbody>
              {data.retired.map((q) => (
                <tr key={q.id}>
                  <td>{q.id}</td>
                  <td>{q.prompt}</td>
                  <td>{q.category}</td>
                  <td>{q.plays} plays</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

