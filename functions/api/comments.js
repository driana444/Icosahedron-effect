// Cloudflare Pages Function: /api/comments
// Needs: KV namespace bound as COMMENTS, secret ADMIN_PASSWORD.
// Optional: send_email binding named MAIL + vars NOTIFY_TO / NOTIFY_FROM for "new comment" emails.
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function same(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const isAdmin = (req, env) => {
  const given = req.headers.get("x-admin") || "";
  return !!env.ADMIN_PASSWORD && !!given && same(env.ADMIN_PASSWORD, given);
};

async function readAll(kv, prefix) {
  const out = [];
  let cursor;
  do {
    const l = await kv.list({ prefix, cursor });
    const items = await Promise.all(l.keys.map((k) => kv.get(k.name, "json")));
    out.push(...items.filter(Boolean));
    cursor = l.list_complete ? undefined : l.cursor;
  } while (cursor);
  return out.sort((x, y) => (x.date < y.date ? -1 : 1));
}

async function notify(env, c) {
  if (!env.MAIL || !env.NOTIFY_TO || !env.NOTIFY_FROM) return;
  try {
    const { EmailMessage } = await import("cloudflare:email");
    const safe = (s) => String(s).replace(/[\r\n]+/g, " ").slice(0, 200);
    const raw =
      `From: Icosahedron Effect <${env.NOTIFY_FROM}>\r\nTo: ${env.NOTIFY_TO}\r\n` +
      `Subject: New comment on ${safe(c.post)}\r\nMessage-ID: <${c.id}@driana.org>\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
      `${c.text}\r\n\r\nApprove or delete: https://driana.org/admin.html\r\n`;
    await env.MAIL.send(new EmailMessage(env.NOTIFY_FROM, env.NOTIFY_TO, raw));
  } catch (e) { /* never block a comment on email trouble */ }
}

export async function onRequest({ request: req, env, waitUntil }) {
  const kv = env.COMMENTS;
  if (!kv) return json({ error: "KV namespace COMMENTS is not bound." }, 503);
  const url = new URL(req.url);

  if (req.method === "GET") {
    if (url.searchParams.get("admin")) {
      if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD is not set." }, 503);
      if (!isAdmin(req, env)) return json({ error: "Wrong password." }, 401);
      return json({ pending: await readAll(kv, "pending/"), approved: await readAll(kv, "approved/") });
    }
    const post = url.searchParams.get("post") || "";
    const all = await readAll(kv, "approved/");
    return json(all.filter((c) => c.post === post).map(({ text, date }) => ({ text, date })));
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
    if (body.hp) return json({ ok: true }, 201);
    const post = String(body.post || "").trim().slice(0, 200);
    const text = String(body.text || "").trim();
    if (!post || !text || text.length > 1000) return json({ error: "Invalid comment." }, 400);
    const l = await kv.list({ prefix: "pending/" });
    if (l.keys.length >= 300) return json({ error: "Too many waiting comments. Please try later." }, 429);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const item = { id, post, text, date: new Date().toISOString() };
    await kv.put(`pending/${id}`, JSON.stringify(item));
    waitUntil(notify(env, item));
    return json({ ok: true }, 201);
  }

  if (req.method === "PUT" || req.method === "DELETE") {
    if (!isAdmin(req, env)) return json({ error: "Wrong password." }, 401);
    let body;
    try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
    const id = String(body.id || "");
    if (!/^[\w-]+$/.test(id)) return json({ error: "Bad id." }, 400);
    if (req.method === "PUT") {
      const item = await kv.get(`pending/${id}`, "json");
      if (!item) return json({ error: "Not found." }, 404);
      await kv.put(`approved/${id}`, JSON.stringify(item));
      await kv.delete(`pending/${id}`);
      return json({ ok: true });
    }
    await kv.delete(`pending/${id}`);
    await kv.delete(`approved/${id}`);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed." }, 405);
}
