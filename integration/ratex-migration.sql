-- Prepared for the rateX application's usual migration workflow.
-- DO NOT run this on production. Copy it to rateX/supabase/migrations
-- with a CLI-generated timestamp and review/apply on development first.
-- This does not modify the ratings, comments, fans, or matches tables.

alter table public.match_news
  add column body text,
  add column content_kind text,
  add column content_licence text,
  add column sportmonks_id bigint,
  add column sportmonks_fixture_id bigint,
  add column sportmonks_type text;

-- The Sportmonks API exposes article text but does not guarantee a canonical
-- public web URL. Our link-only news items keep their existing URLs.
alter table public.match_news alter column url drop not null;

alter table public.match_news
  add constraint match_news_body_limit check (body is null or char_length(body) between 1 and 50000),
  add constraint match_news_body_kind check (content_kind is null or content_kind in ('original', 'licensed')),
  add constraint match_news_licence_note_length check (
    content_licence is null or char_length(btrim(content_licence)) between 10 and 200
  ),
  add constraint match_news_sportmonks_type check (sportmonks_type is null or sportmonks_type in ('prematch','postmatch')),
  add constraint match_news_sportmonks_positive check (sportmonks_id is null or sportmonks_id > 0),
  add constraint match_news_sportmonks_fixture_positive check (sportmonks_fixture_id is null or sportmonks_fixture_id > 0),
  add constraint match_news_import_not_original check (
    sportmonks_id is null or content_kind is distinct from 'original'
  ),
  add constraint match_news_body_publish_rights check (
    status <> 'published' or body is null or
    (content_kind = 'original' and sportmonks_id is null) or
    (content_kind = 'licensed' and content_licence is not null and char_length(btrim(content_licence)) >= 10)
  ),
  add constraint match_news_destination check (url is not null or body is not null);

-- Standard UNIQUE, rather than partial UNIQUE, for idempotent PostgREST
-- on_conflict=sportmonks_id. PostgreSQL permits multiple NULLs.
alter table public.match_news add constraint match_news_sportmonks_id_key unique (sportmonks_id);
create index match_news_sportmonks_fixture_idx on public.match_news(sportmonks_fixture_id)
  where sportmonks_fixture_id is not null;
