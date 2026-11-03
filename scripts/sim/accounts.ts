/**
 * npm run sim:accounts: create an account on one "device", sign in on another,
 * and check both play as the same player; plus wrong passwords, lockout,
 * taken usernames and changing the password.
 */
import { BASE, Checks, ensureServer } from "./lib";

const stop = await ensureServer();
const checks = new Checks();
const run = Date.now().toString(36);

async function call(pid: string, method: string, path: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Player-Id": pid },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

try {
  const mac = `sim-acct-${run}-mac`;
  const phone = `sim-acct-${run}-phone`;
  const user = `Diver_${run.slice(-5)}`;

  await call(mac, "POST", "/api/player", { nickname: `Mac${run.slice(-4)}` });
  const before = await call(mac, "GET", "/api/player");

  checks.check("a new browser is a guest", (await call(mac, "GET", "/api/account")).data.username === null);
  checks.check("short passwords are refused", (await call(mac, "POST", "/api/account/create", { username: user, password: "123" })).status === 400);
  checks.check("bad usernames are refused", (await call(mac, "POST", "/api/account/create", { username: "a b", password: "secret1" })).status === 400);
  const made = await call(mac, "POST", "/api/account/create", { username: user, password: "secret12" });
  checks.check("account created", made.status === 200 && made.data.username === user, JSON.stringify(made));
  checks.check("this browser is now signed in", (await call(mac, "GET", "/api/account")).data.username === user);
  checks.check("a second account on the same browser is refused", (await call(mac, "POST", "/api/account/create", { username: `${user}x`, password: "secret12" })).status === 409);
  checks.check("taken usernames are refused (any capitals)", (await call(phone, "POST", "/api/account/create", { username: user.toUpperCase(), password: "secret12" })).status === 409);

  checks.check("wrong password is refused", (await call(phone, "POST", "/api/account/login", { username: user, password: "nope123" })).status === 401);
  checks.check("unknown username gets the same answer", (await call(phone, "POST", "/api/account/login", { username: `nobody${run}`, password: "nope123" })).status === 401);
  const login = await call(phone, "POST", "/api/account/login", { username: user.toLowerCase(), password: "secret12" });
  checks.check("signing in on another device gives the same player", login.status === 200 && login.data.playerId === mac, JSON.stringify(login));
  checks.check("the account's name comes with it", login.data.nickname === before.data.nickname);
  const fromPhone = await call(String(login.data.playerId), "GET", "/api/player");
  checks.check("same friend code on both devices", fromPhone.data.friendCode === before.data.friendCode);

  checks.check("password change needs the current password", (await call(mac, "POST", "/api/account/password", { current: "wrong1", next: "newpass1" })).status === 401);
  checks.check("password changed", (await call(mac, "POST", "/api/account/password", { current: "secret12", next: "newpass1" })).status === 200);
  checks.check("old password no longer works", (await call(phone, "POST", "/api/account/login", { username: user, password: "secret12" })).status === 401);
  checks.check("new password works", (await call(phone, "POST", "/api/account/login", { username: user, password: "newpass1" })).status === 200);

  let last = 0;
  for (let i = 0; i < 8; i++) last = (await call(phone, "POST", "/api/account/login", { username: user, password: `bad${i}xyz` })).status;
  checks.check("8 wrong passwords lock the account", last === 429);
  checks.check("even the right password waits out the lock", (await call(phone, "POST", "/api/account/login", { username: user, password: "newpass1" })).status === 429);

  console.log(checks.ok ? "\nACCOUNTS SIMULATION PASSED" : "\nACCOUNTS SIMULATION FAILED");
  if (!checks.ok) process.exitCode = 1;
} finally {
  stop();
}
