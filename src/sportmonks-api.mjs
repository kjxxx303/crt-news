import { parseArticle, dedupeArticles } from "./news.mjs";

const BASE = "https://api.sportmonks.com/v3/football/news";

export async function fetchPremierLeagueNews({ token, perPage = 5, pages = 1, requestedTypes = ["prematch", "postmatch"], fetchImpl = fetch }) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("Missing or invalid SPORTMONKS_API_TOKEN. Check your local .env.local.");
  }
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 50 || !Number.isInteger(pages) || pages < 1 || pages > 30) {
    throw new Error("Use --per-page 1–50 and --pages 1–30.");
  }
  const all = [];
  const skipped = [];
  let requests = 0;
  for (const type of requestedTypes) {
    const endpoint = type === "prematch" ? "pre-match" : type === "postmatch" ? "post-match" : null;
    if (!endpoint) throw new Error("Unknown news type.");
    for (let page = 1; page <= pages; page++) {
      const url = new URL(BASE + "/" + endpoint);
      url.searchParams.set("filters", "newsitemLeagues:8");
      url.searchParams.set("include", "lines");
      url.searchParams.set("per_page", String(perPage));
      url.searchParams.set("page", String(page));
      url.searchParams.set("order", "desc");
      let response;
      try {
        response = await fetchImpl(url, {
          headers: { Authorization: token },
          signal: AbortSignal.timeout(20000),
          cache: "no-store",
        });
      } catch {
        throw new Error("Couldn't reach Sportmonks. No files or databases changed.");
      }
      requests++;
      if (!response.ok) throw new Error("Sportmonks News HTTP " + response.status + ". No files or databases changed.");
      let payload;
      try { payload = await response.json(); } catch { throw new Error("Sportmonks returned invalid JSON."); }
      if (!Array.isArray(payload?.data)) throw new Error("Sportmonks didn't return a data array.");
      for (const raw of payload.data) {
        const parsed = parseArticle(raw, type);
        if (parsed.ok) all.push(parsed.article);
        else skipped.push({ id: Number.isSafeInteger(raw?.id) ? raw.id : null, reason: parsed.reason });
      }
      if (!payload.pagination?.has_more || payload.data.length === 0) break;
    }
  }
  return { articles: dedupeArticles(all), skipped, requests };
}
