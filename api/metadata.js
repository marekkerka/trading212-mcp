import { origin, cors, sendJson, query } from "../lib/util.js";

// Serves both OAuth discovery documents (selected via ?doc=...)
export default function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  const o = origin(req);
  const { doc } = query(req);
  if (doc === "resource") {
    return sendJson(res, 200, {
      resource: `${o}/mcp`,
      authorization_servers: [o],
      bearer_methods_supported: ["header"],
      resource_name: "Trading 212 (jen čtení)",
    });
  }
  return sendJson(res, 200, {
    issuer: o,
    authorization_endpoint: `${o}/authorize`,
    token_endpoint: `${o}/token`,
    registration_endpoint: `${o}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["read"],
  });
}
