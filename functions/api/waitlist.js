// Scout Pro waitlist endpoint.
// POST { email, source } -> forwards to Loops.so contact create.
//
// Required env (set in Cloudflare Pages dashboard -> Settings -> Environment variables):
//   LOOPS_API_KEY  - bearer token from app.loops.so > Settings > API
//
// Optional env:
//   ALLOWED_ORIGINS - comma-separated extra origins to allow (custom domain)

const LOOPS_ENDPOINT = 'https://app.loops.so/api/v1/contacts/create';

const KNOWN_SOURCES = new Set([
  'dwell-5min', 'pdf-2nd', 'fav-click', 'fav-upsell',
  'pdf-paywall', 'waitlist', 'unknown',
]);

export async function onRequestPost(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400, cors);
  }

  const email = String(body.email || '').trim().toLowerCase();
  const rawSource = String(body.source || 'unknown').slice(0, 64);
  const source = KNOWN_SOURCES.has(rawSource) ? rawSource : 'unknown';

  if (!isValidEmail(email)) {
    return json({ error: 'invalid_email' }, 400, cors);
  }

  if (!env.LOOPS_API_KEY) {
    // Fail open so the client UX isn't blocked while the secret is being wired.
    // The client still keeps the email in its retry queue and will try again later.
    return json({ ok: true, queued: false, note: 'backend_not_configured' }, 200, cors);
  }

  // Note: we deliberately do NOT forward `source` to Loops as a top-level
  // field — Loops 400s on unknown contact properties unless they're pre-
  // registered in the audience settings. `userGroup` is documented and safe.
  // If you want per-trigger analytics later, define a custom property
  // "source" in Loops > Audience Properties, then add it back to the body.
  void source;

  try {
    const r = await fetch(LOOPS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.LOOPS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        userGroup: 'scout-waitlist',
        subscribed: true,
      }),
    });

    // 200 = created. 409 = already exists. Both are success from our POV.
    if (r.ok || r.status === 409) {
      return json({ ok: true }, 200, cors);
    }

    // Don't echo the upstream body — it may contain the email (PII).
    console.error('loops_upstream_error', 'status=' + r.status);
    return json({ error: 'upstream' }, 502, cors);
  } catch (err) {
    // Log only the error name/code, not the message (could include URL or body).
    const code = (err && err.name) ? err.name : 'Error';
    console.error('loops_fetch_failed', 'code=' + code);
    return json({ error: 'upstream' }, 502, cors);
  }
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request, context.env),
  });
}

export async function onRequest(context) {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { 'Allow': 'POST, OPTIONS', ...corsHeaders(context.request, context.env) },
  });
}

function isValidEmail(email) {
  if (!email || email.length > 254) return false;
  // Pragmatic validation. Loops will reject anything weirder downstream.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const baseAllowed = [
    'https://scout-3qu.pages.dev',
    'http://localhost:8080',
    'http://localhost:3000',
    'http://localhost:4173',
    'http://localhost:5173',
    'http://127.0.0.1:8080',
  ];
  const extra = (env && env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',') : [])
    .map(s => s.trim()).filter(Boolean);
  const allowed = [...baseAllowed, ...extra];

  // Branch / preview deploys on CF Pages — pinned to this project only.
  const cfPreview = /^https:\/\/[a-z0-9-]+\.scout-3qu\.pages\.dev$/.test(origin);

  // Note: we intentionally do NOT allow *.github.io by default — that would
  // let any GitHub Pages site burn the Loops quota. Add the specific GH Pages
  // URL (e.g. https://username.github.io) to the ALLOWED_ORIGINS env when
  // the GH Pages fallback is wired up.
  const ok = allowed.includes(origin) || cfPreview;

  return {
    'Access-Control-Allow-Origin': ok ? origin : 'https://scout-3qu.pages.dev',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(payload, status, extraHeaders) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}
