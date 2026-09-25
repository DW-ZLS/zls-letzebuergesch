#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { getSpeller } from "./spell/speller.js";

async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  // Warm the spellchecker in the background so the first check is fast.
  getSpeller().catch((err) => console.error("[zls-mcp] spellchecker failed to load:", err));
  console.error("[zls-mcp] ready on stdio");
}

main().catch((err) => {
  console.error("[zls-mcp] fatal:", err);
  process.exit(1);
});
