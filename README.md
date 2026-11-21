# crt-news

A **separate, code-only** staging repository for Premier League match news used by [rateX](https://github.com/kjxxx303/come-rate-this).

**Important:** This repository is PUBLIC. Never commit API keys, Supabase secrets, or fetched licensed article text. The local output folder is gitignored. The importer does not write to Rate X unless explicitly run with `--apply`, and it refuses any database except the known Rate X **development** Supabase project.

## Current state

- Sportmonks pre-match and post-match News endpoints have been tested by the project owner: both returned HTTP 200 with Premier League data (21 November 2026).
- The fetching and parsing tools in this repository stage articles locally, matching the Sportmonks fixture ID and retaining attribution.
- A read-only development preview maps Sportmonks fixtures to rateX matches **without any schema changes**. A separate importer can create **unpublished drafts** only after the accompanying Rate X migration has been reviewed and applied on development. It does not publish, alter existing news, or touch ratings/comments.
- Rate X's public News reader and its admin publish UI are **not** changed by this repository. The separate rateX application must implement the in-app reader and licensed publishing workflow before article bodies appear to fans.

## Requirements

Node.js 24+ (built-in `fetch`, `--env-file`; no npm packages required).

On the Mac, keep credentials in the existing Rate X `.env.local` file, **not** here:

- `SPORTMONKS_API_TOKEN`
- `NEXT_PUBLIC_SUPABASE_URL` (development)
- `SUPABASE_SECRET_KEY` (development, only for the optional import)

From a local clone of this repo:

```bash
# Fetch 5 recent articles per type (read-only; private local file)
node --env-file="/Users/kjx/Desktop/come rate this/.env.local" scripts/fetch-news.mjs

# Fetch more Premier League articles
node --env-file="/Users/kjx/Desktop/come rate this/.env.local" scripts/fetch-news.mjs --per-page 50 --pages 5

# Preview which archived fixture IDs match Rate X development (read-only; NO MIGRATION REQUIRED)
node --env-file="/Users/kjx/Desktop/come rate this/.env.local" scripts/import-to-ratex.mjs

# AFTER reviewing the schema migration and applying it to Rate X development:
# Only draft imports; no publishing or production access.
node --env-file="/Users/kjx/Desktop/come rate this/.env.local" scripts/import-to-ratex.mjs --apply

# Unit tests (no external API calls)
node --test
```

If your existing Rate X checkout has a different location, replace the quoted `--env-file` path. Run these commands from the **crt-news repository folder**, not the Rate X application.

The fetch step writes `data/private/premier-league-news.json`; this private local file contains article bodies and **must not be committed or shared publicly**. The command displays only IDs/titles and counts. Each fetch hits just the requested Sportmonks pages.

## Data mapping

- Sportmonks `id` → `match_news.sportmonks_id` (unique; never duplicate a story).
- Sportmonks `fixture_id` → matching `sportmonks_fixture_archive.sm_fixture_id` → rateX `match_id`. **Never guess by headline or team names.**
- Sportmonks `type` → `prematch` or `postmatch`.
- `lines[].text` → plain-text body with paragraphs, ordered by the supplied line ID. No raw HTML or image copying.
- `created_at` / `published_at` → article date when valid. When the API omits a timestamp, the importer uses the verified match kickoff date and records `article_date_basis = fixture` (NOT a claimed publication date). The eventual Rate X reader must label this **Match date**, not **Published**.
- Article title and first paragraph → title and summary.
- `source` = `Sportmonks`. No fabricated original-article URL.
- New items always `draft`, not published, and are kept distinct from existing admin-created news.

The migration in `integration/ratex-migration.sql` is **not applied automatically**. It must first be copied into the Rate X application's normal `supabase/migrations/` workflow and applied **to development only** with the owner's approval. The migration adds draft body, licensing fields, Sportmonks IDs and permits an article with a body but no invented external URL.

## Publication and licence check

Sportmonks markets articles as ready to integrate into customer apps, but third-party publication, attribution, term limits and storage rights should be confirmed for Rate X's domain/subscription. The importer stages **drafts only** and requires a separate licensing decision prior to publishing. Sportmonks post-match reports are AI-generated; any article reader should disclose this clearly.

See [Sportmonks Football News API](https://www.sportmonks.com/football-api/football-news-api/) and [Sportmonks Terms of Service](https://www.sportmonks.com/terms-of-service/).

## Safety

- This repository never calls the Rate X production database.
- No database writes unless `--apply` is explicitly provided; even then, only a new `match_news` draft can be inserted.
- No SQL changes are run by these tools.
- API tokens are read from environment variables and sent only as an HTTP header to Sportmonks.
- No external images are downloaded.
- Re-running skips already imported Sportmonks IDs and does not overwrite admin edits.
