#!/usr/bin/env node
// Development-only importer of Sportmonks news into Rate X match_news drafts.
// Default: dry run. --apply is the only mode that makes database writes.
// Requires integration/ratex-migration.sql to be reviewed and applied first.
// Never touches live production, comments, ratings, existing article edits,
// or published news. Never publishes anything.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dedupeArticles, NEWS_TYPES, PREMIER_LEAGUE_ID } from "../src/news.mjs";

const ALLOWED_DEV_PROJECT = "sqmkloablrxmnexuqkpl";
const BATCH_SIZE = 100;
const BATCH_QUERY_SIZE = 150;

const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

function getTarget() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!raw || !key) throw new Error("Development NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  let url;
  try { url = new URL(raw); } catch { throw new Error("Invalid development Supabase URL."); }
  if (url.protocol !== "https:" || url.hostname !== ALLOWED_DEV_PROJECT + ".supabase.co") {
    throw new Error("Refusing to access an unknown or production database. Expected Rate X development only.");
  }
  if ([process.env.NODE_ENV, process.env.VERCEL_ENV, process.env.APP_ENV].includes("production")) {
    throw new Error("Refusing to run in a production environment.");
  }
  return { url: url.origin, key };
}

function makeDb({ url, key }, fetchImpl = fetch) {
  return async function query(table, { select = "*", where = [], method = "GET", rows } = {}) {
    const endpoint = new URL(url + "/rest/v1/" + table);
    endpoint.searchParams.set("select", select);
    for (const [name, value] of where) endpoint.searchParams.set(name, value);
    const headers = { apikey: key, Authorization: "Bearer " + key, Accept: "application/json" };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      headers.Prefer = "resolution=ignore-duplicates,return=minimal";
      endpoint.searchParams.set("on_conflict", "sportmonks_id");
    }
    let response;
    try {
      response = await fetchImpl(endpoint, { method, headers, ...(method === "POST" ? { body: JSON.stringify(rows) } : {}), signal: AbortSignal.timeout(20000), cache: "no-store" });
    } catch { throw new Error("Couldn't reach development Supabase. Check connectivity."); }
    if (!response.ok) {
      if (table === "match_news" && response.status === 400) throw new Error("News schema not ready: review and apply integration/ratex-migration.sql on development before importing.");
      // No response body: it might contain sensitive information from the service.
      throw new Error("Development Supabase " + table + " returned HTTP " + response.status + ".");
    }
    return method === "POST" ? null : await response.json();
  };
}

async function matchDrafts(articles, query, { checkExisting = true } = {}) {
  const fixtureIds = [...new Set(articles.map((a) => a.fixtureId))];
  const fixtureMap = new Map();
  for (const group of chunk(fixtureIds, BATCH_QUERY_SIZE)) {
    const rows = await query("sportmonks_fixture_archive", { select: "sm_fixture_id,match_id", where: [["sm_fixture_id", "in.(" + group.join(",") + ")"]] });
    for (const row of rows) {
      const old = fixtureMap.get(row.sm_fixture_id);
      if (old && old !== row.match_id) throw new Error("Fixture archive conflict: one Sportmonks ID maps to multiple Rate X matches.");
      fixtureMap.set(row.sm_fixture_id, row.match_id);
    }
  }
  const matchIds = [...new Set(fixtureMap.values())];
  const matchMap = new Map();
  for (const group of chunk(matchIds, BATCH_QUERY_SIZE)) {
    const rows = await query("matches", { select: "id,competition_id,kickoff_at", where: [["id", "in.(" + group.join(",") + ")"]] });
    for (const row of rows) matchMap.set(row.id, row);
  }
  const competitionIds = [...new Set([...matchMap.values()].map((m) => m.competition_id))];
  const competitions = new Map();
  for (const group of chunk(competitionIds, BATCH_QUERY_SIZE)) {
    const rows = await query("competitions", { select: "id,name,visibility", where: [["id", "in.(" + group.join(",") + ")"]] });
    for (const row of rows) competitions.set(row.id, row);
  }
  // Existing-ID lookup requires the proposed migration. A read-only preview
  // can match fixtures safely before any schema change has been approved.
  const existing = new Set();
  if (checkExisting) {
    for (const group of chunk(articles.map((a) => a.id), BATCH_QUERY_SIZE)) {
      const rows = await query("match_news", { select: "sportmonks_id", where: [["sportmonks_id", "in.(" + group.join(",") + ")"]] });
      for (const row of rows) existing.add(row.sportmonks_id);
    }
  }

  const draftRows = [];
  const skips = [];
  for (const a of articles) {
    const matchId = fixtureMap.get(a.fixtureId);
    if (!matchId || !matchMap.has(matchId)) { skips.push({ id: a.id, reason: "fixture not archived in Rate X" }); continue; }
    const competition = competitions.get(matchMap.get(matchId).competition_id);
    if (competition?.visibility !== "public" || competition?.name !== "Premier League") {
      skips.push({ id: a.id, reason: "not a public Premier League match" });
      continue;
    }
    if (existing.has(a.id)) { skips.push({ id: a.id, reason: "already imported (left unchanged)" }); continue; }
    draftRows.push({
      match_id: matchId,
      title: a.title,
      summary: a.summary,
      body: a.body,
      url: null,
      source: "Sportmonks",
      article_date: a.articleDate ?? matchMap.get(matchId).kickoff_at.slice(0, 10),
      article_date_basis: a.articleDate ? "source" : "fixture",
      status: "draft",
      pinned: false,
      content_kind: null,
      content_licence: null,
      sportmonks_id: a.id,
      sportmonks_fixture_id: a.fixtureId,
      sportmonks_type: a.type,
    });
  }
  return { draftRows, skips };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const unexpected = process.argv.slice(2).filter((x) => x !== "--apply");
  if (unexpected.length) throw new Error("Unknown arguments: " + unexpected.join(" "));
  const raw = JSON.parse(await readFile(resolve("data/private/premier-league-news.json"), "utf8"));
  if (raw?.leagueId !== PREMIER_LEAGUE_ID || !Array.isArray(raw.articles)) throw new Error("Invalid staging file (wrong league).");
  const valid = raw.articles.every((a) =>
    Number.isSafeInteger(a.id) && a.id > 0 &&
    Number.isSafeInteger(a.fixtureId) && a.fixtureId > 0 &&
    a.leagueId === PREMIER_LEAGUE_ID &&
    NEWS_TYPES.includes(a.type) &&
    typeof a.title === "string" && a.title.length >= 1 && a.title.length <= 120 &&
    typeof a.summary === "string" && a.summary.length >= 1 && a.summary.length <= 400 &&
    typeof a.body === "string" && a.body.length >= 1 && a.body.length <= 50000 &&
    (a.articleDate === null || /^\d{4}-\d{2}-\d{2}$/.test(a.articleDate))
  );
  if (!valid) throw new Error("Staged articles failed validation; re-fetch them.");
  const articles = dedupeArticles(raw.articles);
  console.log("Rate X DEVELOPMENT only (" + ALLOWED_DEV_PROJECT + "). Mode:", apply ? "APPLY drafts" : "DRY RUN (zero writes)");
  const query = makeDb(getTarget());
  const { draftRows, skips } = await matchDrafts(articles, query, { checkExisting: apply });
  console.log("Read from local file:", articles.length, "| New matched draft candidates:", draftRows.length, "| Skipped:", skips.length);
  for (const skip of skips.slice(0, 40)) console.log("SKIP", skip.id, "-", skip.reason);
  for (const row of draftRows.slice(0, 40)) console.log("DRAFT", row.sportmonks_id, row.sportmonks_type, row.sportmonks_fixture_id, row.article_date, row.title);
  if (!apply) {
    console.log("Preview only: candidates have NOT been checked against existing Sportmonks news IDs (migration not required).");
    console.log("No database changes. After the Rate X development migration, run again with --apply to save unpublished drafts.");
    return;
  }
  let batches = 0;
  for (const group of chunk(draftRows, BATCH_SIZE)) {
    await query("match_news", { method: "POST", rows: group, select: "id" });
    batches++;
  }
  console.log("Submitted", draftRows.length, "unpublished draft candidates in", batches, "batch(es); conflicting Sportmonks IDs ignored.");
  console.log("Nothing published. No production connection possible from this script.");
}

main().catch((error) => { console.error("Import failed:", error.message); process.exitCode = 1; });
