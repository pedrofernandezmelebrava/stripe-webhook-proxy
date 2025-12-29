import express from "express";
import Stripe from "stripe";
import fetch from "node-fetch";

const app = express();

// Healthcheck
app.get("/", (_req, res) => res.status(200).send("ok"));

// Stripe webhook endpoint (RAW body only here)
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      // Recomendado: fija la API version para evitar sorpresas con cambios de Stripe
      apiVersion: process.env.STRIPE_API_VERSION || "2023-10-16",
    });

    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const appsScriptUrl = process.env.APPS_SCRIPT_URL; // https://script.google.com/macros/s/.../exec
    const proxySecret = process.env.PROXY_SECRET;

    if (!endpointSecret) {
      console.error("❌ Missing STRIPE_WEBHOOK_SECRET");
      return res.status(500).send("missing_stripe_webhook_secret");
    }
    if (!appsScriptUrl) {
      console.error("❌ Missing APPS_SCRIPT_URL");
      return res.status(500).send("missing_apps_script_url");
    }
    if (!proxySecret) {
      console.error("❌ Missing PROXY_SECRET");
      return res.status(500).send("missing_proxy_secret");
    }

    // 1) Verify Stripe signature
    let event;
    try {
      const sig = req.headers["stripe-signature"];
      if (!sig) return res.status(400).send("missing_stripe_signature");

      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error("❌ Signature verification failed:", err?.message || err);
      return res.status(400).send(`Webhook Error: ${err?.message || String(err)}`);
    }

    // Minimal logging (event already verified)
    console.log(
      "✅ Event:",
      event.type,
      "id=",
      event.id,
      "livemode=",
      event.livemode
    );

    // 2) Forward to Apps Script with proxy_secret in query string
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
        redirect: "follow",
      });

      const text = await forwardRes.text();

      console.log(
        "➡️ Forwarded to Apps Script:",
        forwardRes.status,
        text.slice(0, 300)
      );

      if (forwardRes.ok) return res.status(200).send("ok");
      return res.status(500).send(`forward_failed_${forwardRes.status}`);
    } catch (err) {
      console.error("❌ Forward error:", err);
      return res.status(500).send("forward_error");
    }
  }
);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on :${port}`));
