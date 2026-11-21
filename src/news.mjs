// Pure parsing/validation. Never render API content as HTML.
export const PREMIER_LEAGUE_ID = 8;
export const NEWS_TYPES = ["prematch", "postmatch"];

const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const safeId = (x) => Number.isSafeInteger(x) && x > 0 ? x : null;

export function dateFromApi(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:[ T]|$)/.test(value)) return null;
  const date = value.slice(0, 10);
  const check = new Date(date + "T00:00:00Z");
  if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== date) return null;
  return date >= "2000-01-01" && date <= "2100-12-31" ? date : null;
}

export function shortSummary(body) {
  const first = body.split("\n\n")[0] || "";
  if (first.length <= 400) return first;
  const max = first.slice(0, 397).trimEnd();
  const space = max.lastIndexOf(" ");
  return (space > 250 ? max.slice(0, space) : max) + "…";
}

export function parseArticle(input, requestedType) {
  if (!isObject(input)) return { ok: false, reason: "not an object" };
  const id = safeId(input.id);
  const fixtureId = safeId(input.fixture_id);
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!id || !fixtureId) return { ok: false, reason: "missing article/fixture ID" };
  if (input.league_id !== PREMIER_LEAGUE_ID) return { ok: false, reason: "not Premier League" };
  if (!NEWS_TYPES.includes(requestedType) || input.type !== requestedType) return { ok: false, reason: "story type mismatch" };
  if (!title || title.length > 120) return { ok: false, reason: "invalid title length" };
  if (!Array.isArray(input.lines)) return { ok: false, reason: "missing article lines" };
  const paragraphs = input.lines.flatMap((entry, index) => {
    if (!isObject(entry) || typeof entry.text !== "string") return [];
    const text = entry.text.trim();
    return text ? [{ sort: safeId(entry.id) ?? index, index, text }] : [];
  }).sort((a, b) => a.sort - b.sort || a.index - b.index);
  const body = paragraphs.map((p) => p.text).join("\n\n");
  if (!body || body.length > 50000) return { ok: false, reason: "missing or excessively long body" };
  const articleDate = dateFromApi(input.published_at) ?? dateFromApi(input.created_at) ?? dateFromApi(input.updated_at);
  if (!articleDate) return { ok: false, reason: "missing article date (not guessing)" };
  return { ok: true, article: { id, fixtureId, leagueId: PREMIER_LEAGUE_ID, type: requestedType, title, articleDate, body, summary: shortSummary(body), paragraphs: paragraphs.length } };
}

export function dedupeArticles(articles) {
  const map = new Map();
  for (const article of articles) {
    const old = map.get(article.id);
    // Repeated IDs are normal across pages; conflicting fixture IDs aren't.
    if (old && (old.fixtureId !== article.fixtureId || old.type !== article.type)) {
      throw new Error("Conflicting Sportmonks article IDs; nothing written.");
    }
    map.set(article.id, article);
  }
  return [...map.values()].sort((a, b) => b.articleDate.localeCompare(a.articleDate) || b.id - a.id);
}
