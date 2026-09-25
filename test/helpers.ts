import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FetchLike } from "../src/lib/http.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
export const fixture = (name: string) => fs.readFileSync(path.join(dir, name), "utf8");
export const fixturePath = (name: string) => path.join(dir, name);

/** Fake LOD API backed by fixture files; records requested URLs. */
export function fakeLod(): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const routes: Array<[RegExp, string]> = [
    [/\/search\?query=haus&lang=lb$/i, "search_lb_haus.json"],
    [/\/search\?query=Haus&lang=lb$/, "search_lb_haus.json"],
    [/\/search\?query=m%C3%A9cht&lang=lb$/i, "search_lb_mecht.json"],
    [/\/search\?query=maachen&lang=lb$/i, "search_lb_mecht.json"],
    [/\/search\?query=house&lang=en$/i, "search_en_house.json"],
    [/\/entry\/HAUS1$/, "entry_HAUS1.json"],
    [/\/entry\/MAACHEN1$/, "entry_MAACHEN1.json"],
    [/\/entry\/SCHEIN1$/, "entry_SCHEIN1.json"],
  ];
  const f: FetchLike = async (url) => {
    calls.push(url);
    for (const [re, file] of routes) {
      if (re.test(url)) return new Response(fixture(file), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (/\/search\?/.test(url)) return new Response('{"description":"","results":[]}', { status: 200 });
    return new Response("Not found", { status: 404 });
  };
  return { fetch: f, calls };
}
