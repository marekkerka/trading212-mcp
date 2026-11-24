// Read-only Trading 212 client. Only GET requests are ever sent.
const BASE = "https://live.trading212.com";

export async function t212Get(creds, path, params = {}) {
  if (!path.startsWith("/api/v0/equity/")) throw new Error("Disallowed path");
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const auth = Buffer.from(`${creds.k}:${creds.s}`).toString("base64");
  const r = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const hint =
      r.status === 401 ? "Neplatný API klíč nebo secret." :
      r.status === 403 ? "Klíč nemá oprávnění pro tento druh dat (zkontroluj oprávnění klíče v Trading 212)." :
      r.status === 429 ? "Překročen limit požadavků Trading 212, zkus to za chvíli znovu." : "";
    const err = new Error(`Trading 212 API ${r.status}. ${hint} ${typeof data === "string" ? data : JSON.stringify(data ?? "")}`.trim());
    err.status = r.status;
    throw err;
  }
  return data;
}

// instrument list cache (endpoint allows 1 req / 50 s)
let instrCache = { at: 0, data: null };
async function instruments(creds) {
  if (instrCache.data && Date.now() - instrCache.at < 10 * 60 * 1000) return instrCache.data;
  const data = await t212Get(creds, "/api/v0/equity/metadata/instruments");
  instrCache = { at: Date.now(), data };
  return data;
}

function pageArgs(a) {
  if (a.next_page_path) {
    const u = new URL(a.next_page_path, BASE);
    if (!u.pathname.startsWith("/api/v0/equity/history/")) throw new Error("next_page_path musí ukazovat na /api/v0/equity/history/");
    return { path: u.pathname, params: Object.fromEntries(u.searchParams) };
  }
  return null;
}

const pagingSchema = {
  limit: { type: "integer", minimum: 1, maximum: 50, description: "Počet záznamů (max 50)." },
  cursor: { type: "string", description: "Kurzor pro další stránku." },
  next_page_path: { type: "string", description: "Hodnota nextPagePath z předchozí odpovědi; když je zadaná, ostatní parametry se ignorují." },
};

export const TOOLS = [
  {
    name: "get_account_summary",
    description: "Souhrn účtu Trading 212: hotovost, investovaná částka, celková hodnota, zisk/ztráta, měna účtu.",
    inputSchema: { type: "object", properties: {} },
    run: (c) => t212Get(c, "/api/v0/equity/account/summary"),
  },
  {
    name: "get_positions",
    description: "Všechny otevřené pozice (ticker, množství, průměrná cena, aktuální cena, P/L).",
    inputSchema: { type: "object", properties: {} },
    run: (c) => t212Get(c, "/api/v0/equity/positions"),
  },
  {
    name: "get_pending_orders",
    description: "Aktuálně čekající (nevyplněné) pokyny.",
    inputSchema: { type: "object", properties: {} },
    run: (c) => t212Get(c, "/api/v0/equity/orders"),
  },
  {
    name: "get_pending_order",
    description: "Detail jednoho čekajícího pokynu podle ID.",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    run: (c, a) => t212Get(c, `/api/v0/equity/orders/${encodeURIComponent(Number(a.id))}`),
  },
  {
    name: "get_order_history",
    description: "Historie pokynů (stránkovaná). Volitelně filtr na ticker.",
    inputSchema: { type: "object", properties: { ...pagingSchema, ticker: { type: "string", description: "Např. AAPL_US_EQ" } } },
    run: (c, a) => {
      const p = pageArgs(a);
      return p ? t212Get(c, p.path, p.params)
        : t212Get(c, "/api/v0/equity/history/orders", { limit: a.limit ?? 50, cursor: a.cursor, ticker: a.ticker });
    },
  },
  {
    name: "get_dividends",
    description: "Historie vyplacených dividend (stránkovaná). Volitelně filtr na ticker.",
    inputSchema: { type: "object", properties: { ...pagingSchema, ticker: { type: "string" } } },
    run: (c, a) => {
      const p = pageArgs(a);
      return p ? t212Get(c, p.path, p.params)
        : t212Get(c, "/api/v0/equity/history/dividends", { limit: a.limit ?? 50, cursor: a.cursor, ticker: a.ticker });
    },
  },
  {
    name: "get_transactions",
    description: "Pohyby peněz na účet a z účtu – vklady, výběry, poplatky (stránkované).",
    inputSchema: { type: "object", properties: { ...pagingSchema, time: { type: "string", description: "ISO datum/čas, od kterého hledat." } } },
    run: (c, a) => {
      const p = pageArgs(a);
      return p ? t212Get(c, p.path, p.params)
        : t212Get(c, "/api/v0/equity/history/transactions", { limit: a.limit ?? 50, cursor: a.cursor, time: a.time });
    },
  },
  {
    name: "search_instruments",
    description: "Vyhledá obchodovatelné instrumenty podle tickeru, ISIN nebo názvu. Vrací max 25 výsledků.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: async (c, a) => {
      const q = String(a.query || "").trim().toLowerCase();
      const all = await instruments(c);
      const hits = (all || []).filter((i) =>
        [i.ticker, i.isin, i.name, i.shortName].some((v) => v && String(v).toLowerCase().includes(q))
      );
      return { total: hits.length, results: hits.slice(0, 25) };
    },
  },
  {
    name: "get_exchanges",
    description: "Burzy dostupné v Trading 212 a jejich obchodní hodiny.",
    inputSchema: { type: "object", properties: {} },
    run: (c) => t212Get(c, "/api/v0/equity/metadata/exchanges"),
  },
  {
    name: "list_reports",
    description: "Seznam již vyžádaných CSV exportů a jejich stav (jen čtení, nový export nevytváří).",
    inputSchema: { type: "object", properties: {} },
    run: (c) => t212Get(c, "/api/v0/equity/history/exports"),
  },
  {
    name: "get_pies",
    description: "Seznam pies (Trading 212 je označuje jako zastaralé, ale stále fungují).",
    inputSchema: { type: "object", properties: {} },
    run: (c) => t212Get(c, "/api/v0/equity/pies"),
  },
  {
    name: "get_pie",
    description: "Detail jednoho pie podle ID.",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    run: (c, a) => t212Get(c, `/api/v0/equity/pies/${encodeURIComponent(Number(a.id))}`),
  },
];
