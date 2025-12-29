import express from "express";
import Stripe from "stripe";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: process.env.STRIPE_API_VERSION || "2023-10-16",
});

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
const appsScriptUrl = process.env.APPS_SCRIPT_URL;
const proxySecret = process.env.PROXY_SECRET;

app.get("/", (_req, res) => res.status(200).send("ok"));

async function handleStripeWebhook(req, res) {
  if (!endpointSecret || !appsScriptUrl || !proxySecret) {
    console.error("❌ Missing env vars", {
      hasEndpointSecret: !!endpointSecret,
      hasAppsScriptUrl: !!appsScriptUrl,
      hasProxySecret: !!proxySecret,
    });
    return res.status(500).send("missing_env_vars");
  }

  let event;
  try {
    const sig = req.headers["stripe-signature"];
    if (!sig) return res.status(400).send("missing_stripe_signature");
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("❌ Signature verification failed:", err?.message || err);
    return res.status(400).send(`Webhook Error: ${err?.message || String(err)}`);
  }

  console.log("✅ Event:", event.type, "id=", event.id, "livemode=", event.livemode);

  try {
    const forwardUrl = new URL(appsScriptUrl);
    forwardUrl.searchParams.set("proxy_secret", proxySecret);

    const forwardRes = await fetch(forwardUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "railway-stripe-proxy/1.0",
      },
      body: JSON.stringify(event),
    });

    const text = await forwardRes.text();
    console.log("➡️ Forwarded to Apps Script:", forwardRes.status, text.slice(0, 300));

    if (forwardRes.ok) return res.status(200).send("ok");
    return res.status(500).send(`forward_failed_${forwardRes.status}`);
  } catch (err) {
    console.error("❌ Forward error:", err);
    return res.status(500).send("forward_error");
  }
}

// ✅ Stripe manda POST con application/json
// Usamos RAW body solo en las rutas webhook
app.post("/", express.raw({ type: "application/json" }), handleStripeWebhook);
app.post("/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on :${port}`));
