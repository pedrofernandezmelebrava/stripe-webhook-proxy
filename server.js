import express from "express";
import Stripe from "stripe";

const app = express();

// Stripe necesita el RAW body para verificar firma
app.use(express.raw({ type: "*/*" }));

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

const appsScriptUrl = process.env.APPS_SCRIPT_URL; // https://script.google.com/macros/s/.../exec
const proxySecret = process.env.PROXY_SECRET;       // secreto tuyo (mismo que en Apps Script)

app.get("/", (req, res) => res.status(200).send("ok"));

app.post("/webhook", async (req, res) => {
  let event;

  // 1) Verificar firma Stripe
  try {
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("❌ Signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 2) Reenviar a Apps Script con proxy_secret por querystring
  try {
    if (!appsScriptUrl) {
      console.error("❌ Missing APPS_SCRIPT_URL");
      return res.status(500).send("missing_apps_script_url");
    }
    if (!proxySecret) {
      console.error("❌ Missing PROXY_SECRET");
      return res.status(500).send("missing_proxy_secret");
    }

    const forwardUrl = new URL(appsScriptUrl);
    forwardUrl.searchParams.set("proxy_secret", proxySecret);

    const forwardRes = await fetch(forwardUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      redirect: "follow"
    });

    const text = await forwardRes.text();
    console.log("➡️ Forwarded to Apps Script:", forwardRes.status, text.slice(0, 300));

    if (forwardRes.ok) return res.status(200).send("ok");

    return res.status(500).send("forward_failed");
  } catch (err) {
    console.error("❌ Forward error:", err);
    return res.status(500).send("forward_error");
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Listening on", port));
