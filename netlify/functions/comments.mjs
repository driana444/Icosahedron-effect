import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

export const config = { path: "/api/comments" };

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function isAdmin(req) {
  const pw = process.env.ADMIN_PASSWORD;
  const given = req.headers.get("x-admin") || "";
  if (!pw || !given) return false;
  const a = Buffer.from(pw), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readAll(store, prefix) {
  const { blobs } = await store.list({ prefix });
  const items = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return items.filter(Boolean).sort((x, y) => (x.date < y.date ? -1 : 1));
}

export default async (req) => {
  const store = getStore({ name: "comments", consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "GET") {
    if (url.searchParams.get("admin")) {
      if (!process.env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD is not set in Netlify." }, 503);
      if (!isAdmin(req)) return json({ error: "Wrong password." }, 401);
      return json({ pending: await readAll(store, "pending/"), approved: await readAll(store, "approved/") });
    }
    const post = url.searchParams.get("post") || "";
    const all = await readAll(store, "approved/");
    return json(all.filter((c) => c.post === post).map(({ text, date }) => ({ text, date })));
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
    if (body.hp) return json({ ok: true }, 201); // honeypot: pretend success
    const post = String(body.post || "").trim().slice(0, 200);
    const text = String(body.text || "").trim();
    if (!post || !text || text.length > 1000) return json({ error: "Invalid comment." }, 400);
    const { blobs } = await store.list({ prefix: "pending/" });
    if (blobs.length >= 300) return json({ error: "Too many waiting comments. Please try later." }, 429);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await store.setJSON(`pending/${id}`, { id, post, text, date: new Date().toISOString() });
    return json({ ok: true }, 201);
  }

  if (req.method === "PUT" || req.method === "DELETE") {
    if (!isAdmin(req)) return json({ error: "Wrong password." }, 401);
    let body;
    try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
    const id = String(body.id || "");
    if (!/^[\w-]+$/.test(id)) return json({ error: "Bad id." }, 400);
    if (req.method === "PUT") {
      const item = await store.get(`pending/${id}`, { type: "json" });
      if (!item) return json({ error: "Not found." }, 404);
      await store.setJSON(`approved/${id}`, item);
      await store.delete(`pending/${id}`);
      return json({ ok: true });
    }
    await store.delete(`pending/${id}`);
    await store.delete(`approved/${id}`);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed." }, 405);
};
