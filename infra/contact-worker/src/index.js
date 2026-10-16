/**
 * POST /api/contact from the website's contact form: verifies the Turnstile
 * token, then emails the message to support (CONTACT_TO) with Reply-To set to
 * the sender, so support can answer by replying. Nothing is stored.
 */
import { EmailMessage } from "cloudflare:email";

const MAX_MESSAGE = 4000;
const CATEGORIES = new Set(["bug", "question", "business", "other"]);
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** One header line, safe: no line breaks (header injection), encoded as UTF-8. */
function header(value) {
  const clean = String(value).replace(/[\r\n]+/g, " ").trim();
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(clean)))}?=`;
}

function base64Lines(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/.{1,76}/g, "$&\r\n");
}

async function turnstileOk(token, ip, secret) {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const data = await result.json().catch(() => ({}));
  // Why it failed (e.g. invalid-input-secret, invalid-input-response): visible with `wrangler tail`.
  if (data.success !== true) console.error("turnstile failed", JSON.stringify(data["error-codes"] ?? []), data.hostname ?? "");
  return data.success === true;
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json(405, { error: "method" });
    if (!env.TURNSTILE_SECRET || !env.CONTACT_TO) return json(503, { error: "not-configured" });

    let input;
    try {
      input = await request.formData();
    } catch {
      return json(400, { error: "form" });
    }
    const name = String(input.get("name") ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 100);
    const email = String(input.get("email") ?? "").trim().slice(0, 200);
    const category = String(input.get("category") ?? "other");
    const title = String(input.get("subject") ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 100);
    const message = String(input.get("message") ?? "").trim();
    const language = input.get("lang") === "en" ? "en" : "ja";
    const token = String(input.get("cf-turnstile-response") ?? "");

    if (!EMAIL.test(email)) return json(400, { error: "email" });
    if (!message || message.length > MAX_MESSAGE) return json(400, { error: "message" });
    if (!CATEGORIES.has(category)) return json(400, { error: "category" });
    if (!token || !(await turnstileOk(token, request.headers.get("CF-Connecting-IP"), env.TURNSTILE_SECRET)))
      return json(403, { error: "turnstile" });

    // The form's 件名, or (older pages) the message's first line.
    const subject = `[LastRide ${category}] ${title || message.split("\n")[0].slice(0, 60)}`;
    const body = [`From: ${name || "(no name)"} <${email}>`, `Category: ${category}`, `Language: ${language}`, ...(title ? [`Subject: ${title}`] : []), "", message].join("\n");
    const raw = [
      `From: ${header("LastRide contact form")} <${env.CONTACT_FROM}>`,
      `To: <${env.CONTACT_TO}>`,
      `Reply-To: <${email}>`,
      `Subject: ${header(subject)}`,
      `Message-ID: <${crypto.randomUUID()}@lastride.jp>`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(body),
    ].join("\r\n");

    try {
      await env.SEND.send(new EmailMessage(env.CONTACT_FROM, env.CONTACT_TO, raw));
    } catch (error) {
      // E.g. the destination isn't a verified address. No message content or addresses logged.
      console.error("send failed", String(error?.message ?? error));
      return json(502, { error: "send" });
    }
    return json(200, { ok: true });
  },
};
