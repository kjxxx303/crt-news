import { test } from "node:test";
import assert from "node:assert/strict";
import { dateFromApi, dedupeArticles, parseArticle, shortSummary } from "../src/news.mjs";

const sample = {
  id: 14564, fixture_id: 19722106, league_id: 8,
  title: "Manchester United and Aston Villa draw", type: "postmatch",
  created_at: "2026-11-08T19:00:00Z",
  lines: [
    { id: 30, type: "line", text: "Second paragraph." },
    { id: 10, type: "line", text: "First paragraph." },
  ],
};

test("parses Premier League article and sorts paragraphs by line ID", () => {
  const result = parseArticle(sample, "postmatch");
  assert.equal(result.ok, true);
  assert.equal(result.article.id, 14564);
  assert.equal(result.article.fixtureId, 19722106);
  assert.equal(result.article.articleDate, "2026-11-08");
  assert.equal(result.article.body, "First paragraph.\n\nSecond paragraph.");
  assert.equal(result.article.summary, "First paragraph.");
});

test("refuses wrong league, missing fixture and mismatched endpoint type", () => {
  assert.equal(parseArticle({ ...sample, league_id: 82 }, "postmatch").ok, false);
  assert.equal(parseArticle({ ...sample, fixture_id: null }, "postmatch").ok, false);
  assert.equal(parseArticle(sample, "prematch").ok, false);
  assert.equal(parseArticle({ ...sample, lines: [] }, "postmatch").ok, false);
});

test("does not invent a date and rejects impossible dates", () => {
  assert.equal(parseArticle({ ...sample, created_at: undefined }, "postmatch").ok, false);
  assert.equal(dateFromApi("2026-02-30T10:00:00Z"), null);
  assert.equal(dateFromApi("2026-11-08 12:00:00"), "2026-11-08");
});

test("truncates overly long summaries and keeps plain text", () => {
  assert.ok(shortSummary("A ".repeat(300)).length <= 400);
  const textOnly = parseArticle({ ...sample, lines: [{ id: 1, text: "<b>This is plain text only</b>" }] }, "postmatch");
  assert.equal(textOnly.ok, true);
  assert.equal(textOnly.article.body, "<b>This is plain text only</b>");
});

test("re-running identical article IDs is idempotent; conflicts fail closed", () => {
  const article = parseArticle(sample, "postmatch").article;
  assert.deepEqual(dedupeArticles([article, article]), [article]);
  assert.throws(() => dedupeArticles([article, { ...article, fixtureId: 11 }]), /Conflicting/);
});
