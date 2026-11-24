# Trading 212 MCP (read-only)

Remote MCP server for the Trading 212 live account, read-only. Deploy on Vercel, set env var `ENC_SECRET` (random string, 32+ chars), then add `https://<project>.vercel.app/mcp` as a custom connector in Claude. On connect, a page asks for your Trading 212 API key + secret; they are verified and sealed (AES-256-GCM) into the OAuth tokens held by Claude, never stored server-side.
