const bcrypt = require("bcryptjs");
const { usersStore, signSession, setCookie, json } = require("./_auth");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Bad JSON" });
  }

  const username = (body.username || "").trim().toLowerCase();
  const password = body.password || "";

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return json(400, { error: "Username must be 3-20 chars: letters, numbers, underscore." });
  }
  if (password.length < 8) {
    return json(400, { error: "Password must be at least 8 characters." });
  }

  const store = usersStore();
  const key = `user:${username}`;

  const existing = await store.get(key, { type: "json" });
  if (existing) {
    return json(409, { error: "Username already taken." });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await store.setJSON(key, {
    username,
    passwordHash,
    tier: "free",
    createdAt: new Date().toISOString(),
  });

  const token = signSession(username);
  return json(201, { ok: true, username }, { "Set-Cookie": setCookie(token) });
};
