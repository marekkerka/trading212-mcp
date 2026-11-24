import crypto from "node:crypto";

// ---------- encryption (stateless tokens) ----------
function encKey() {
  const s = process.env.ENC_SECRET;
  if (!s || s.length < 32) throw new Error("ENC_SECRET is not configured");
  return crypto.createHash("sha256").update(s).digest();
}

export function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}

export function open(str) {
  try {
    const b = Buffer.from(String(str), "base64url");
    if (b.length < 29) return null;
    const d = crypto.createDecipheriv("aes-256-gcm", encKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    const pt = Buffer.concat([d.update(b.subarray(28)), d.final()]);
    return JSON.parse(pt.toString("utf8"));
  } catch {
    return null;
  }
}

export const now = () => Math.floor(Date.now() / 1000);

// ---------- http helpers ----------
export function origin(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  return `${proto}://${host}`;
}

export function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version"
  );
  res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id");
}

export function sendJson(res, status, obj, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}

export async function readBody(req) {
  if (req.body !== undefined && req.body !== null && !(Buffer.isBuffer(req.body))) {
    if (typeof req.body === "object") return req.body;
    return parseRaw(String(req.body), req.headers["content-type"]);
  }
  if (Buffer.isBuffer(req.body)) return parseRaw(req.body.toString("utf8"), req.headers["content-type"]);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return parseRaw(Buffer.concat(chunks).toString("utf8"), req.headers["content-type"]);
}

function parseRaw(text, ct = "") {
  if (!text) return {};
  if (ct.includes("application/json")) {
    try { return JSON.parse(text); } catch { return { __invalid_json: true }; }
  }
  if (ct.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  try { return JSON.parse(text); } catch { return Object.fromEntries(new URLSearchParams(text)); }
}

export function query(req) {
  return Object.fromEntries(new URL(req.url, "http://x").searchParams);
}

// ---------- redirect URI policy ----------
const ALLOWED_EXACT = new Set([
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
]);

export function redirectAllowed(uri) {
  if (typeof uri !== "string") return false;
  if (ALLOWED_EXACT.has(uri)) return true;
  try {
    const u = new URL(uri);
    // local callbacks used by Claude Desktop / Claude Code
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
