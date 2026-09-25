import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { UpstreamError } from "../lib/http.js";

export const text = (t: string): CallToolResult => ({ content: [{ type: "text", text: t }] });

export const json = (data: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});

export const toolError = (msg: string): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: msg }],
});

/** Wrap a handler so upstream failures become readable tool errors instead of protocol errors. */
export function safe<A>(fn: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (err) {
      if (err instanceof UpstreamError) return toolError(err.message);
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(`Unexpected error: ${msg}`);
    }
  };
}
