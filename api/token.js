import crypto from "node:crypto";
import { cors, sendJson, readBody, open, seal, now } from "../lib/util.js";

const AT_TTL = 3600;            // 1 hour
const RT_TTL = 90 * 24 * 3600;  // 90 days

function issue(k, s, cid) {
  return {
    access_token: seal({ t: "at", k, s, exp: now() + AT_TTL }),
    token_type: "Bearer",
    expires_in: AT_TTL,
    refresh_token: seal({ t: "rt", k, s, cid, exp: now() + RT_TTL }),
    scope: "read",
  };
}

const bad = (res, error, desc) => sendJson(res, 400, { error, error_description: desc });

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return sendJson(res, 405, { error: "method_not_allowed" });
  const b = await readBody(req);

  if (b.grant_type === "authorization_code") {
    const c = open(b.code);
    if (!c || c.t !== "code" || c.exp < now()) return bad(res, "invalid_grant", "Kód je neplatný nebo vypršel.");
    if (b.redirect_uri && b.redirect_uri !== c.r) return bad(res, "invalid_grant", "redirect_uri nesouhlasí.");
    if (b.client_id && b.client_id !== c.cid) return bad(res, "invalid_grant", "client_id nesouhlasí.");
    if (!b.code_verifier) return bad(res, "invalid_request", "Chybí code_verifier.");
    const chal = crypto.createHash("sha256").update(String(b.code_verifier)).digest("base64url");
    if (chal !== c.cc) return bad(res, "invalid_grant", "PKCE ověření selhalo.");
    return sendJson(res, 200, issue(c.k, c.s, c.cid));
  }

  if (b.grant_type === "refresh_token") {
    const r = open(b.refresh_token);
    if (!r || r.t !== "rt" || r.exp < now()) return bad(res, "invalid_grant", "Refresh token je neplatný nebo vypršel.");
    if (b.client_id && b.client_id !== r.cid) return bad(res, "invalid_grant", "client_id nesouhlasí.");
    return sendJson(res, 200, issue(r.k, r.s, r.cid));
  }

  return bad(res, "unsupported_grant_type", "Podporováno: authorization_code, refresh_token.");
}
