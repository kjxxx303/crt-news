#!/usr/bin/env node
// Fetch Premier League news to a gitignored local file. No database writes.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fetchPremierLeagueNews } from "../src/sportmonks-api.mjs";

function numericArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const raw = process.argv[index + 1];
  if (!/^\d+$/.test(raw ?? "")) throw new Error(name + " must be a positive whole number.");
  return Number(raw);
}
async function main() {
  const typeAt = process.argv.indexOf("--type");
  const type = typeAt < 0 ? "both" : process.argv[typeAt + 1];
  if (!["both", "prematch", "postmatch"].includes(type)) throw new Error("--type must be both, prematch or postmatch.");
  const requestedTypes = type === "both" ? ["prematch", "postmatch"] : [type];
  const { articles, skipped, requests } = await fetchPremierLeagueNews({
    token: process.env.SPORTMONKS_API_TOKEN,
    perPage: numericArg("--per-page", 5),
    pages: numericArg("--pages", 1),
    requestedTypes,
  });
  const folder = resolve("data/private");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const target = resolve(folder, "premier-league-news.json");
  await writeFile(target, JSON.stringify({ retrievedAt: new Date().toISOString(), source: "Sportmonks News API", leagueId: 8, articles }, null, 2) + "\n", { mode: 0o600 });
  console.log("Sportmonks API requests:", requests);
  console.log("Valid Premier League articles:", articles.length);
  console.log("Skipped invalid/incomplete records:", skipped.length);
  if (skipped.length) console.log("Skip reasons:", skipped.slice(0, 20));
  console.log("Local-only file:", target, "(gitignored; includes licensed article bodies)");
  for (const a of articles.slice(0, 20)) console.log(a.id, a.type, a.fixtureId, a.articleDate, a.title);
  console.log("Nothing imported or published to rateX.");
}
main().catch((error) => { console.error("Failed:", error.message); process.exitCode = 1; });
