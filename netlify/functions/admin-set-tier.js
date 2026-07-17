const { verifySession, usersStore, json, getTier } = require("./_auth");

const VALID = ["free", "plus", "max"];

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const session = verifySession(event);
  if (!session) return json(401, { error: "Not logged in." });

  const store = usersStore();
  const admin = await store.get(`user:${session.username}`, { type: "json" });
  if (!admin || !admin.isAdmin) return json(403, { error: "Admin only." });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Bad JSON" });
  }

  const target = (body.username || "").trim().toLowerCase();
  const tier = (body.tier || "").toLowerCase();

  if (!VALID.includes(tier)) return json(400, { error: "Invalid tier. Use free, plus, or max." });

  const user = await store.get(`user:${target}`, { type: "json" });
  if (!user) return json(404, { error: "User not found." });

  user.tier = tier;
  await store.setJSON(`user:${target}`, user);

  return json(200, { ok: true, username: target, tier, tierLabel: getTier(tier).label });
};
