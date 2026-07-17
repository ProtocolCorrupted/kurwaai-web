const { verifySession, checkClaudeQuota, consumeClaudeQuota, getUserTierConfig, getTier, FEATURES, json } = require("./_auth");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_VERSION = "2023-06-01";

// Human-friendly model labels for the UI.
const MODEL_LABELS = {
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-opus-4-8": "Claude Opus 4.8",
  "claude-fable-5": "Claude Fable 5",
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const session = verifySession(event);
  if (!session) return json(401, { error: "Not logged in." });

  if (!FEATURES.claude) return json(503, { error: "Claude access is not enabled by the operator yet." });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Bad JSON" });
  }

  const tierCfg = await getUserTierConfig(session.username);
  if (!tierCfg.claude) return json(403, { error: "Claude access requires a Plus or Max plan." });

  const model = body.model;
  if (!tierCfg.claude.models.includes(model)) {
    return json(403, { error: "Your plan does not include this model." });
  }

  const message = (body.message || "").toString().slice(0, 8000);
  if (!message.trim()) return json(400, { error: "Empty message." });

  if (!ANTHROPIC_API_KEY) return json(503, { error: "Claude API key is not configured by the operator yet." });

  const quota = await checkClaudeQuota(session.username, tierCfg.label.toLowerCase());
  if (!quota.ok) return quota;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: message }],
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return json(res.status, { error: data.error?.message || "Claude request failed." });
    }

    const text = (data.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    const tokens = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
    await consumeClaudeQuota(session.username, tokens);

    return json(200, { response: text, model, tokensUsed: tokens });
  } catch (err) {
    return json(502, { error: "Failed to reach Claude. Try again shortly." });
  }
};

// Helper exported for the frontend to list allowed models per tier.
exports.modelsForTier = (tierName) => {
  const cfg = getTier(tierName).claude;
  if (!cfg) return [];
  return cfg.models.map((m) => ({ id: m, label: MODEL_LABELS[m] || m }));
};
