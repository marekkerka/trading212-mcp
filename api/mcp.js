import { origin, cors, sendJson, readBody, open, now } from "../lib/util.js";
import { TOOLS } from "../lib/t212.js";

const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];

function unauthorized(req, res) {
  const meta = `${origin(req)}/.well-known/oauth-protected-resource/mcp`;
  return sendJson(res, 401, { error: "invalid_token" }, {
    "WWW-Authenticate": `Bearer resource_metadata="${meta}"`,
  });
}

async function handleOne(msg, creds) {
  const { id, method, params = {} } = msg || {};
  const isNotification = id === undefined || id === null;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

  if (!msg || msg.jsonrpc !== "2.0" || typeof method !== "string") {
    return isNotification ? null : fail(-32600, "Invalid Request");
  }
  if (isNotification) return null;

  switch (method) {
    case "initialize": {
      const v = SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED[0];
      return ok({
        protocolVersion: v,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "trading212-readonly", title: "Trading 212 (jen čtení)", version: "1.0.0" },
        instructions:
          "Read-only access to the user's live Trading 212 Invest/ISA account. No tool can place, change or cancel orders. Amounts are in the account currency returned by get_account_summary.",
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name, description, inputSchema,
          annotations: { readOnlyHint: true, openWorldHint: true },
        })),
      });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return fail(-32602, `Unknown tool: ${params.name}`);
      try {
        const data = await tool.run(creds, params.arguments || {});
        return ok({ content: [{ type: "text", text: JSON.stringify(data, null, 1) }] });
      } catch (e) {
        return ok({ content: [{ type: "text", text: String(e.message || e) }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${method}`);
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  const auth = req.headers.authorization || "";
  const tok = auth.startsWith("Bearer ") ? open(auth.slice(7).trim()) : null;
  if (!tok || tok.t !== "at" || tok.exp < now()) return unauthorized(req, res);

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST, OPTIONS");
    return res.end();
  }

  const body = await readBody(req);
  if (body && body.__invalid_json) return sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });

  const creds = { k: tok.k, s: tok.s };
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleOne(m, creds)))).filter(Boolean);
    if (!out.length) { res.statusCode = 202; return res.end(); }
    return sendJson(res, 200, out);
  }
  const out = await handleOne(body, creds);
  if (!out) { res.statusCode = 202; return res.end(); }
  return sendJson(res, 200, out);
}
