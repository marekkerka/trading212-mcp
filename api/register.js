import { cors, sendJson, readBody, seal, now, redirectAllowed } from "../lib/util.js";

// Dynamic client registration (RFC 7591), stateless: client_id is a sealed blob.
export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return sendJson(res, 405, { error: "method_not_allowed" });
  const body = await readBody(req);
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (!uris.length || !uris.every(redirectAllowed)) {
    return sendJson(res, 400, { error: "invalid_redirect_uri", error_description: "Povolené jsou jen callbacky Clauda." });
  }
  const client_id = seal({ t: "client", r: uris });
  return sendJson(res, 201, {
    client_id,
    client_id_issued_at: now(),
    client_name: body.client_name || "MCP client",
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
}
