const Stripe = require("stripe");
const { verifySession, json, usersStore } = require("./_auth");

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const PRICE_PLUS = process.env.STRIPE_PRICE_PLUS;
const PRICE_MAX = process.env.STRIPE_PRICE_MAX;
const SITE_URL = process.env.URL || process.env.DEPLOY_PRIME_URL || "https://kurwaai.netlify.app";

const PRICE_FOR = { plus: PRICE_PLUS, max: PRICE_MAX };

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const session = verifySession(event);
  if (!session) return json(401, { error: "Not logged in." });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Bad JSON" });
  }

  const tier = body.tier;
  if (!PRICE_FOR[tier]) return json(400, { error: "Unknown plan." });
  if (!STRIPE_SECRET_KEY || !PRICE_FOR[tier]) {
    return json(503, { error: "Subscriptions are not configured by the operator yet." });
  }

  try {
    const stripe = new Stripe(STRIPE_SECRET_KEY);
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: session.username,
      customer_email: body.email || undefined,
      line_items: [{ price: PRICE_FOR[tier], quantity: 1 }],
      success_url: `${SITE_URL}/?upgraded=${tier}`,
      cancel_url: `${SITE_URL}/?upgrade=cancelled`,
      metadata: { username: session.username, tier },
    });
    return json(200, { url: checkout.url });
  } catch (err) {
    return json(502, { error: "Could not start checkout: " + err.message });
  }
};
