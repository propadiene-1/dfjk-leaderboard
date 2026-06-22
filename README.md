# DFJK Leaderboard

Adds chart leaderboards and global player standings to [**DFJK**](https://www.rebitwise.com/games/dfjk/), a popular typing / rhythm game.

Scores are hosted on Supabase.

## Option 1: Chrome Extension

1. Download the file (Code > Download ZIP)

2. Unzip

3. Unpack Chrome extension (chrome://extensions > Turn on Developer mode > Load Unpacked > dfjk-leaderboard-main)

4. Play the game :D

## Option 2: Browser Bookmark

1. Open Bookmarks bar (Ctrl+Shift+B / Cmd+Shift+B) > Right click > Add page

2. Create bookmark with URL: 
    ```
    javascript:(function(){if(window.__dfjkLBInjected)return;window.__dfjkLBInjected=1;var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/gh/propadiene-1/dfjk-leaderboard@main/content.js';document.body.appendChild(s);})();
    ```
    
3. Open the game and click the bookmark :D

## Features

- **Chart leaderboard** - top 5 times for the current chart

- **Global standings** - top 5 players by best time (for key counts 25, 50, 75, 100)

- **Score saving** - enter username + press <kbd>s</kbd> to save

- **Player lookup panel** - look up any player's scores

- **[new update] Colors-only mode** - optionally hide the key letters

## Configuration

If you want to use your own database, change the `SUPABASE_URL` / `SUPABASE_KEY` variables at the top of `content.js`. Board sizes, refresh rate, and panel sides are also constants in the `CONFIG` block there.

Score table setup for Supabase (run in SQL Editor):

```sql
create table scores (
  id          bigint generated always as identity primary key,
  chart_id    int    not null,
  username    text   not null check (char_length(username) between 1 and 20),
  time_ms     int    not null check (time_ms > 0),
  accuracy    real   not null,
  cps         real   not null,
  length      int,                                     -- key count (chart length)
  created_at  timestamptz default now()
);
create index scores_chart_time_idx on scores (chart_id, time_ms);
create index scores_length_time_idx on scores (length, time_ms);
create index scores_user_length_time_idx on scores (lower(username), length, time_ms);

grant select, insert on public.scores to anon;

alter table scores enable row level security;
create policy read_all   on scores for select using (true);
create policy insert_sane on scores for insert with check (
  cps < 20 and time_ms > 1000 and char_length(username) <= 20
  and (length is null or length between 10 and 500)
);

-- one row per player per key count (their best time); global standings read this
create or replace view best_scores with (security_invoker = true) as
select distinct on (lower(username), length)
  username, length, chart_id, time_ms, accuracy, cps
from scores
order by lower(username), length, time_ms asc;
grant select on best_scores to anon;
```

### Migrating an existing database

If your `scores` table predates the `length` column, run this once. The
backfill is exact because the game reports `cps = length / time`, so
`cps * time` recovers the original key count.

```sql
alter table scores add column if not exists length int;
update scores set length = round(cps * time_ms / 1000.0) where length is null;
create index if not exists scores_length_time_idx on scores (length, time_ms);
create index if not exists scores_user_length_time_idx on scores (lower(username), length, time_ms);

drop policy if exists insert_sane on scores;
create policy insert_sane on scores for insert with check (
  cps < 20 and time_ms > 1000 and char_length(username) <= 20
  and (length is null or length between 10 and 500)
);

-- global standings read this view (best time per player per key count)
create or replace view best_scores with (security_invoker = true) as
select distinct on (lower(username), length)
  username, length, chart_id, time_ms, accuracy, cps
from scores
order by lower(username), length, time_ms asc;
grant select on best_scores to anon;
```