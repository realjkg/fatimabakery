export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/square-events/status") {
      return requirePullAuth(request, env) || await status(env);
    }

    if (request.method === "GET" && url.pathname === "/api/square-events/pull") {
      return requirePullAuth(request, env) || await pullEvents(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/square-events/ack") {
      return requirePullAuth(request, env) || await ackEvents(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/square-webhook") {
      return await handleSquareWebhookRequest(request, env);
    }

    if (request.method === "GET") {
      return json({ status: "ok", service: "fatima-square-webhook" }, 200);
    }

    return json({ status: "not_found" }, 404);
  }
};

async function handleSquareWebhookRequest(request, env) {
  const rawBody = await request.text();

  const signature =
    request.headers.get("x-square-hmacsha256-signature") ||
    request.headers.get("X-Square-HmacSha256-Signature") ||
    "";

  const notificationUrl = env.SQUARE_WEBHOOK_NOTIFICATION_URL;

  const valid = await verifySquareSignature(
    rawBody,
    signature,
    env.SQUARE_WEBHOOK_SIGNATURE_KEY,
    notificationUrl
  );

  if (!valid) {
    return json({ status: "forbidden", reason: "invalid_square_signature" }, 403);
  }

  let evt;
  try {
    evt = JSON.parse(rawBody);
  } catch (err) {
    return json({ status: "bad_request", reason: "invalid_json" }, 400);
  }

  const eventId = evt.event_id;
  if (!eventId) {
    return json({ status: "bad_request", reason: "missing_event_id" }, 400);
  }

  const payment = evt?.data?.object?.payment || {};
  const paymentId = payment.id || evt?.data?.id || "";

  try {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO square_events
      (event_id, type, merchant_id, payment_id, raw_json, status, received_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      eventId,
      evt.type || "",
      evt.merchant_id || "",
      paymentId,
      rawBody
    ).run();

    return json({ status: "square_received_durable", event_id: eventId }, 200);
  } catch (err) {
    console.error("D1 write failed", err);
    return json({ status: "temporary_failure", reason: "d1_write_failed" }, 503);
  }
}

async function pullEvents(request, env) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") || "25"), 50);

  const result = await env.DB.prepare(`
    SELECT event_id, type, raw_json
    FROM square_events
    WHERE
      status IN ('pending', 'retry')
      OR (status = 'leased' AND lease_until < datetime('now'))
    ORDER BY received_at ASC
    LIMIT ?
  `).bind(limit).all();

  const events = result.results || [];

  for (const ev of events) {
    await env.DB.prepare(`
      UPDATE square_events
      SET status = 'leased',
          attempts = attempts + 1,
          lease_until = datetime('now', '+5 minutes'),
          updated_at = CURRENT_TIMESTAMP
      WHERE event_id = ? AND status != 'acked'
    `).bind(ev.event_id).run();
  }

  return json({ status: "ok", count: events.length, events }, 200);
}

async function ackEvents(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ status: "bad_request", reason: "invalid_json" }, 400);
  }

  const ids = Array.isArray(body.event_ids) ? body.event_ids : [];

  for (const id of ids) {
    await env.DB.prepare(`
      UPDATE square_events
      SET status = 'acked',
          acked_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE event_id = ?
    `).bind(id).run();
  }

  return json({ status: "ok", acked: ids.length }, 200);
}

async function status(env) {
  const result = await env.DB.prepare(`
    SELECT status, COUNT(*) AS count
    FROM square_events
    GROUP BY status
    ORDER BY status
  `).all();

  return json({ status: "ok", counts: result.results || [] }, 200);
}

function requirePullAuth(request, env) {
  const auth = request.headers.get("authorization") || "";
  const expected = "Bearer " + env.WORKER_PULL_TOKEN;

  if (!env.WORKER_PULL_TOKEN || auth !== expected) {
    return json({ status: "unauthorized" }, 401);
  }

  return null;
}

async function verifySquareSignature(rawBody, signatureHeader, signatureKey, notificationUrl) {
  if (!signatureHeader || !signatureKey || !notificationUrl) return false;

  const message = notificationUrl + rawBody;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signatureKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );

  const expected = base64Encode(new Uint8Array(sig));
  return timingSafeEqual(expected, signatureHeader);
}

function base64Encode(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function timingSafeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");

  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return mismatch === 0;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" }
  });
}
