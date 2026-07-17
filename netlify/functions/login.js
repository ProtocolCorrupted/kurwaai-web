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

  const store = usersStore();
  const user = await store.get(`user:${username}`, { type: "json" });

  if (!user) return json(401, { error: "Invalid username or password." });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return json(401, { error: "Invalid username or password." });

  const token = signSession(username);
  return json(200, { ok: true, username }, { "Set-Cookie": setCookie(token) });
};
