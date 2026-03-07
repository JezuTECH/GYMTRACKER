const LOGIN_REDIRECT_FLAG = "gymtracker_login_in_progress";
const LOGIN_REDIRECT_TTL_MS = 5 * 60 * 1000;

const readStoredRedirect = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOGIN_REDIRECT_FLAG);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ts = Number(parsed?.ts);
    if (!Number.isFinite(ts) || ts <= 0) return null;
    return { ts };
  } catch {
    return null;
  }
};

const readLoginRedirectAge = () => {
  const stored = readStoredRedirect();
  if (!stored) return Infinity;
  return Date.now() - stored.ts;
};

const hasFreshLoginRedirectFlag = () => readLoginRedirectAge() < LOGIN_REDIRECT_TTL_MS;

const setLoginRedirectFlag = () => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOGIN_REDIRECT_FLAG, JSON.stringify({ ts: Date.now() }));
  } catch {}
};

const clearLoginRedirectFlag = () => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LOGIN_REDIRECT_FLAG);
  } catch {}
};

export {
  LOGIN_REDIRECT_FLAG,
  clearLoginRedirectFlag,
  hasFreshLoginRedirectFlag,
  readLoginRedirectAge,
  setLoginRedirectFlag,
};
