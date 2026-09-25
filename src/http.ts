#!/usr/bin/env node
/**
 * Streamable HTTP transport (stateless) — what a public, remote connector uses.
 * For now this is for local testing only:  npm run start:http  → http://127.0.0.1:3000/mcp
 */
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { config, VERSION } from "./config.js";
import { LodClient } from "./lod/client.js";
import { createServer } from "./server.js";
import { getSpeller } from "./spell/speller.js";

const allowedHosts = config.allowedHosts ? config.allowedHosts.split(",").map((h) => h.trim()).filter(Boolean) : undefined;
const app = createMcpExpressApp({ host: config.httpHost, allowedHosts });

// One LOD client (and cache) shared across requests; a fresh MCP server per request (stateless mode).
const lod = new LodClient();

// Serve MCP on /mcp and on / so the connector works with or without the /mcp suffix.
app.post(["/mcp", "/"], async (req: Request, res: Response) => {
  const server = createServer({ lod });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[zls-mcp] request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

const methodNotAllowed = (_req: Request, res: Response) =>
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server: use POST)." }, id: null });
app.get("/mcp", methodNotAllowed);
app.delete(["/mcp", "/"], methodNotAllowed);
app.get("/", (req: Request, res: Response) => {
  if ((req.headers.accept ?? "").includes("text/event-stream")) return methodNotAllowed(req, res);
  res.type("text/plain").send(`ZLS – Lëtzebuergesch MCP server v${VERSION}\nMCP endpoint: POST /mcp\nHealth: /healthz\n`);
});

app.get("/healthz", (_req: Request, res: Response) => res.json({ ok: true, version: VERSION }));

app.listen(config.httpPort, config.httpHost, () => {
  console.error(`[zls-mcp] Streamable HTTP on http://${config.httpHost}:${config.httpPort}/mcp`);
  getSpeller().catch((err) => console.error("[zls-mcp] spellchecker failed to load:", err));
});
