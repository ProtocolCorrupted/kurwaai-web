const Stripe = require("stripe");
const { json, usersStore } = require("./_auth");

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Stripe requires the raw request body to verify the signature.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    return json(503, { error: "Webhook not configured." });
  }

  const signature = event.headers["stripe-signature"];
  if (!signature) return json(400, { error: "Missing signature." });

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return json(400, { error: "Bad JSON" });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY);
  let eventObj;
  try {
    eventObj = stripe.webhooks.constructEvent(event.body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return json(400, { error: "Invalid signature: " + err.message });
  }

  if (eventObj.type === "checkout.session.completed") {
    const session = eventObj.data.object;
    const username = session.client_reference_id || session.metadata?.username;
    const tier = session.metadata?.tier;
    if (username && (tier === "plus" || tier === "max")) {
      const store = usersStore();
      const user = await store.get(`user:${username}`, { type: "json" });
      if (user) {
        user.tier = tier;
        user.stripeCustomerId = session.customer;
        user.subscriptionId = session.subscription;
        await store.setJSON(`user:${username}`, user);
      }
    }
  }

  if (eventObj.type === "customer.subscription.deleted") {
    const sub = eventObj.data.object;
    const store = usersStore();
    const username = sub.metadata?.username;
    if (username) {
      const user = await store.get(`user:${username}`, { type: "json" });
      if (user) {
        user.tier = "free";
        await store.setJSON(`user:${username}`, user);
      }
    }
  }

  return json(200, { received: true });
};
