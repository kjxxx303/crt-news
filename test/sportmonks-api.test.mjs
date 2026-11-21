import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchPremierLeagueNews } from "../src/sportmonks-api.mjs";

const story = {
  id: 14564, fixture_id: 19722106, league_id: 8,
  title: "Manchester United and Aston Villa draw", type: "postmatch",
  created_at: "2026-11-08T19:00:00Z", lines: [{ id: 1, text: "First paragraph.", type: "line" }],
};

test("uses League 8 filter and header credentials, never URL tokens", async () => {
  const observed = [];
  const result = await fetchPremierLeagueNews({
    token: "safe_test_token",
    requestedTypes: ["postmatch"],
    perPage: 5,
    fetchImpl: async (url, options) => {
      observed.push({ url, options });
      return { ok: true, json: async () => ({ data: [story], pagination: { has_more: false } }) };
    },
  });
  assert.equal(result.articles.length, 1);
  assert.equal(result.requests, 1);
  assert.equal(observed[0].url.searchParams.get("filters"), "newsitemLeagues:8");
  assert.equal(observed[0].url.searchParams.get("include"), "lines");
  assert.equal(observed[0].options.headers.Authorization, "safe_test_token");
  assert.ok(!String(observed[0].url).includes("safe_test_token"));
});

test("reports broken articles as skipped, not imported", async () => {
  const result = await fetchPremierLeagueNews({
    token: "safe_test_token", requestedTypes: ["postmatch"],
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: [story, { ...story, id: 77, lines: [] }] }) }),
  });
  assert.equal(result.articles.length, 1);
  assert.equal(result.skipped.length, 1);
});

test("fails clearly on missing subscription access without leaking credentials", async () => {
  await assert.rejects(
    fetchPremierLeagueNews({
      token: "safe_test_token", requestedTypes: ["postmatch"],
      fetchImpl: async () => ({ ok: false, status: 403 }),
    }), /HTTP 403/
  );
});
