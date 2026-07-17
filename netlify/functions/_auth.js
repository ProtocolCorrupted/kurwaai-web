const jwt = require("jsonwebtoken");
const { getStore } = require("@netlify/blobs");

const SECRET = process.env.JWT_SECRET || "change-me-in-netlify-env-vars";
const COOKIE_NAME = "kurwaai_session";

// Fail closed: if the default secret is still in place on a deployed site,
// refuse to mint/verify sessions instead of silently running insecure.
const IS_PRODUCTION = process.env.CONTEXT === "production" || process.env.NETLIFY === "true";
if (IS_PRODUCTION && SECRET === "change-me-in-netlify-env-vars") {
  throw new Error("JWT_SECRET is not set — refusing to start in production.");
}

const OLLAMA_URL = (process.env.OLLAMA_URL || "").replace(/\/$/, "");
const COMFY_URL = (process.env.COMFY_URL || "").replace(/\/$/, "");

const DISCORD_INVITE = process.env.DISCORD_INVITE || "https://disboard.org/server/1504909141095874662";
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || "kurwaai").toLowerCase();

// Shared model endpoints (operator's PC, exposed via tunnel).
const MODELS = {
  ollamaChat: "gemma3:4b",
};

// Feature flags (operator toggles here). Image gen is OFF until a stronger GPU is available.
// Claude is gated by user tier (Plus/Max), so it stays enabled by default.
const FEATURES = {
  imageGen: process.env.ENABLE_IMAGE_GEN === "true" || false, // default disabled
  claude: process.env.ENABLE_CLAUDE === "true" || true,      // enabled; tier-gated
};

// Tier configuration. Limits are resolved from here so new tiers = config only.
const TIERS = {
  free: {
    label: "Free",
    local: { dailyMsgMax: 5000, rpmMax: 30, queueMax: 2 },
    claude: null,
  },
  plus: {
    label: "Plus",
    local: { dailyMsgMax: 5000, rpmMax: 30, queueMax: 2 },
    claude: {
      models: ["claude-haiku-4-5-20251001"],
      msgMax: 500,
      tokenMax: 5_000_000,
      windowMs: 5 * 60 * 60 * 1000, // 5 hours
    },
  },
  max: {
    label: "Max",
    local: { dailyMsgMax: 100000, rpmMax: 600, queueMax: 8 },
    claude: {
      models: [
        "claude-fable-5",
        "claude-opus-4-8",
        "claude-sonnet-5",
        "claude-haiku-4-5-20251001",
      ],
      msgMax: 10000,
      tokenMax: 100_000_000,
      windowMs: 5 * 60 * 60 * 1000,
    },
  },
};

function getTier(name) {
  return TIERS[name] || TIERS.free;
}

function usersStore() {
  return getStore("kurwaai-users");
}

// Stores used for cross-user rate limiting / queue.
function limitsStore() {
  return getStore("kurwaai-limits");
}

function signSession(username) {
  return jwt.sign({ username }, SECRET, { expiresIn: "30d" });
}

function verifySession(event) {
  const cookieHeader = event.headers.cookie || "";
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  try {
    return jwt.verify(match[1], SECRET);
  } catch {
    return null;
  }
}

function setCookie(token) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`;
}

function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  };
}

const todayKey = () => new Date().toISOString().slice(0, 10);

// ---- Per-user local usage tracking ----
async function getUserLimits(username) {
  const store = usersStore();
  const key = `limits:${username}`;
  let rec = await store.get(key, { type: "json" });
  const today = todayKey();
  if (!rec || rec.date !== today) {
    rec = { date: today, msgCount: 0, rpm: [] };
  }
  return rec;
}

async function saveUserLimits(username, rec) {
  await usersStore().setJSON(`limits:${username}`, rec);
}

// ---- Global queue (concurrent users) ----
async function getQueue() {
  const store = limitsStore();
  let q = await store.get("active_users", { type: "json" });
  if (!q) q = { count: 0, updatedAt: Date.now() };
  return q;
}

// Acquire a slot for a local (Ollama/ComfyUI) request.
// Enforces: daily message cap, 30 RPM (rolling 60s), and global queue cap.
// Holds up to `holdMs` (GeForce-Now style) waiting for a free queue slot.
// Returns { ok, status, body, rec, release } or an error response object.
async function acquireLocalSlot(username, holdMs = 30000) {
  const tier = await getUserTierConfig(username);
  const cfg = tier.local;

  const rec = await getUserLimits(username);
  if (rec.msgCount >= cfg.dailyMsgMax) {
    return json(429, { error: `Daily message limit reached (${cfg.dailyMsgMax}). Resets tomorrow.` });
  }

  const now = Date.now();
  rec.rpm = (rec.rpm || []).filter((t) => now - t < 60000);
  if (rec.rpm.length >= cfg.rpmMax) {
    return json(429, { error: `Too many requests — ${cfg.rpmMax} per minute. Slow down a sec.` });
  }

  // Wait for a free global queue slot.
  const deadline = now + holdMs;
  while (Date.now() < deadline) {
    const q = await getQueue();
    if (q.count < cfg.queueMax) {
      q.count += 1;
      q.updatedAt = Date.now();
      await limitsStore().setJSON("active_users", q);
      rec.msgCount += 1;
      rec.rpm.push(Date.now());
      await saveUserLimits(username, rec);
      const release = async () => {
        const cur = await getQueue();
        cur.count = Math.max(0, cur.count - 1);
        cur.updatedAt = Date.now();
        await limitsStore().setJSON("active_users", cur);
      };
      return { ok: true, rec, release };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return json(503, { error: "All GPU slots are busy right now. You're in the queue — try again in a moment." });
}

// ---- Claude quota (Plus/Max) ----
async function checkClaudeQuota(username, tierName) {
  const cfg = getTier(tierName).claude;
  if (!cfg) return json(403, { error: "Claude access requires a Plus or Max plan." });

  const store = usersStore();
  const key = `claude:${username}`;
  const now = Date.now();
  let rec = await store.get(key, { type: "json" });
  if (!rec || now - (rec.windowStart || 0) >= cfg.windowMs) {
    rec = { windowStart: now, msgCount: 0, tokenCount: 0 };
  }
  if (rec.msgCount >= cfg.msgMax) {
    return json(429, { error: `Claude daily message limit reached (${cfg.msgMax}).` });
  }
  if (rec.tokenCount >= cfg.tokenMax) {
    return json(429, { error: `Claude token window limit reached (${cfg.tokenMax}). Resets in a few hours.` });
  }
  return { ok: true, rec, cfg };
}

async function consumeClaudeQuota(username, tokens) {
  const store = usersStore();
  const key = `claude:${username}`;
  const rec = await store.get(key, { type: "json" });
  if (!rec) return;
  rec.msgCount = (rec.msgCount || 0) + 1;
  rec.tokenCount = (rec.tokenCount || 0) + (tokens || 0);
  await store.setJSON(key, rec);
}

// Resolve a user's full tier config from their stored tier field.
async function getUserTierConfig(username) {
  const user = await usersStore().get(`user:${username}`, { type: "json" });
  return getTier(user && user.tier ? user.tier : "free");
}

module.exports = {
  SECRET,
  COOKIE_NAME,
  OLLAMA_URL,
  COMFY_URL,
  MODELS,
  DISCORD_INVITE,
  ADMIN_USERNAME,
  TIERS,
  getTier,
  usersStore,
  limitsStore,
  FEATURES,
  signSession,
  verifySession,
  setCookie,
  clearCookie,
  json,
  getUserLimits,
  saveUserLimits,
  acquireLocalSlot,
  checkClaudeQuota,
  consumeClaudeQuota,
  getUserTierConfig,
};
