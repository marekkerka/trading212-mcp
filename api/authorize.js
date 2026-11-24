import { readBody, query, open, seal, now, escapeHtml, redirectAllowed } from "../lib/util.js";
import { t212Get } from "../lib/t212.js";

function validate(p) {
  if (p.response_type !== "code") return "response_type musí být code";
  const client = open(p.client_id);
  if (!client || client.t !== "client") return "Neznámý klient";
  if (!p.redirect_uri || !client.r.includes(p.redirect_uri) || !redirectAllowed(p.redirect_uri)) return "Neplatná redirect_uri";
  if (!p.code_challenge || p.code_challenge_method !== "S256") return "Chybí PKCE (S256)";
  return null;
}

const FIELDS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"];

function page(p, error) {
  const hidden = FIELDS.map((f) => `<input type="hidden" name="${f}" value="${escapeHtml(p[f])}">`).join("");
  return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Připojit Trading 212</title>
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,-apple-system,sans-serif;max-width:420px;margin:0 auto;padding:32px 20px;line-height:1.45}
h1{font-size:1.35rem;margin:0 0 8px}
p{margin:0 0 16px;opacity:.85}
label{display:block;font-weight:600;margin:14px 0 6px}
input[type=password],input[type=text]{width:100%;box-sizing:border-box;padding:12px;font-size:16px;border:1px solid #8886;border-radius:10px;background:transparent;color:inherit}
button{margin-top:20px;width:100%;padding:13px;font-size:16px;font-weight:600;border:0;border-radius:10px;background:#1a73e8;color:#fff}
.err{background:#d9303022;border:1px solid #d9303066;padding:10px 12px;border-radius:10px;margin-bottom:12px}
.note{font-size:.85rem;opacity:.7;margin-top:18px}
</style></head><body>
<h1>Připojit Trading 212 ke Claudovi</h1>
<p>Vlož API klíč a secret ze živého účtu (Trading 212 → Nastavení → API). Claude bude mít přístup <b>jen pro čtení</b>.</p>
${error ? `<div class="err">${escapeHtml(error)}</div>` : ""}
<form method="post" action="/authorize" autocomplete="off">
${hidden}
<label for="k">API klíč</label><input id="k" name="api_key" type="text" required autocapitalize="off" spellcheck="false">
<label for="s">API secret</label><input id="s" name="api_secret" type="password" required>
<button type="submit">Připojit</button>
</form>
<p class="note">Klíč se nikde neukládá. Server ho jen zašifruje do přístupového tokenu, který drží Claude. Doporučení: klíči v Trading 212 povol jen oprávnění pro čtení.</p>
</body></html>`;
}

function html(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(body);
}

export default async function handler(req, res) {
  const p = req.method === "POST" ? await readBody(req) : query(req);
  const problem = validate(p);
  if (problem) return html(res, 400, `<!DOCTYPE html><meta charset="utf-8"><p style="font-family:system-ui;padding:24px">Chyba: ${escapeHtml(problem)}</p>`);

  if (req.method !== "POST") return html(res, 200, page(p));

  const k = String(p.api_key || "").trim();
  const s = String(p.api_secret || "").trim();
  if (!k || !s) return html(res, 400, page(p, "Vyplň klíč i secret."));

  try {
    await t212Get({ k, s }, "/api/v0/equity/account/summary");
  } catch (e) {
    const msg = e.status === 401 ? "Trading 212 klíč odmítl. Zkontroluj, že jde o klíč ze živého (ne demo) účtu a že secret sedí."
      : e.status === 403 ? "Klíč nemá oprávnění ke čtení údajů o účtu. Povol ho v nastavení API klíče."
      : e.status === 429 ? "Trading 212 teď omezuje počet požadavků. Zkus to za pár sekund."
      : "Ověření klíče se nepovedlo: " + e.message;
    return html(res, 400, page(p, msg));
  }

  const code = seal({ t: "code", k, s, cid: p.client_id, r: p.redirect_uri, cc: p.code_challenge, exp: now() + 300 });
  const u = new URL(p.redirect_uri);
  u.searchParams.set("code", code);
  if (p.state) u.searchParams.set("state", p.state);
  res.statusCode = 302;
  res.setHeader("Location", u.toString());
  res.setHeader("Cache-Control", "no-store");
  res.end();
}
