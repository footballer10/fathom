/** Admin API client. The token lives in this browser's localStorage only. */

const KEY = "krillion.adminToken";

export function getToken(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export class AdminError extends Error {
  constructor(
    public status: number,
    message: string,
    public payload?: unknown,
  ) {
    super(message);
  }
}

export async function admin<T>(path: string, init: { method?: string; body?: unknown; text?: boolean } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (init.text && res.ok) return (await res.text()) as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 422) throw new AdminError(res.status, (data as { error?: string }).error ?? `HTTP ${res.status}`, data);
  return data as T;
}

export interface AdminStatus {
  today: string;
  bufferDays: number;
  filledDaysAhead: number;
  openDates: { date: string; openSlots: number[] }[];
  poolSize: number;
  poolCap: number;
  reserveCount: number;
  retiredCount: number;
  totalQuestions: number;
  categoryUsage: Record<string, number>;
  prompts: { id: string; prompt: string; category: string; status: string }[];
  scheduled: { id: string; date: string; slot: number }[];
}

export type ScheduleDay = { date: string; slots: ({ id: string; prompt: string; category: string } | null)[] };
