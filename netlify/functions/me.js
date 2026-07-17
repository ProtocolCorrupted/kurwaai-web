const { usersStore, verifySession, json, getTier, getUserLimits, FEATURES, DISCORD_INVITE } = require("./_auth");
const claude = require("./claude");

exports.handler = async (event) => {
  const session = verifySession(event);
  if (!session) return json(401, { error: "Not logged in." });

  const store = usersStore();
  const user = await store.get(`user:${session.username}`, { type: "json" });
  if (!user) return json(401, { error: "Session invalid." });

  const tierName = user.tier || "free";
  const tier = getTier(tierName);
  const today = new Date().toISOString().slice(0, 10);

  const rec = await store.get(`limits:${session.username}`, { type: "json" });
  const localUsed = rec && rec.date === today ? rec.msgCount : 0;

  let claudeInfo = null;
  if (tier.claude) {
    const cRec = await store.get(`claude:${session.username}`, { type: "json" });
    const now = Date.now();
    const fresh = cRec && now - (cRec.windowStart || 0) < tier.claude.windowMs;
    claudeInfo = {
      models: claude.modelsForTier(tierName),
      msgMax: tier.claude.msgMax,
      msgUsed: fresh ? cRec.msgCount : 0,
      tokenMax: tier.claude.tokenMax,
      tokenUsed: fresh ? cRec.tokenCount : 0,
      windowMs: tier.claude.windowMs,
    };
  }

  return json(200, {
    username: user.username,
    tier: tierName,
    tierLabel: tier.label,
    isAdmin: !!user.isAdmin,
    discordInvite: DISCORD_INVITE,
    features: { imageGen: FEATURES.imageGen, claude: FEATURES.claude },
    local: {
      dailyMsgMax: tier.local.dailyMsgMax,
      dailyMsgUsed: localUsed,
      rpmMax: tier.local.rpmMax,
      queueMax: tier.local.queueMax,
    },
    claude: claudeInfo,
  });
};
