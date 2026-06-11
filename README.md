## DFJK Leaderboard

Adds chart leaderboards and global player standings to [**DFJK**](https://www.rebitwise.com/games/dfjk/), a popular typing / rhythm game.

Scores are hosted on Supabase.

### How to Use (Chome Extension)

1. Download the file (Code > Download ZIP)

2. Unzip

3. Unpack Chrome extension (chrome://extensions > Turn on Developer mode > Load Unpacked > dfjk-leaderboard-main)

4. Play the game :D

### How to Use (Bookmark)

1. Open Bookmarks bar (Ctrl+Shift+B / Cmd+Shift+B) > Right click > Add page

2. Create bookmark with URL: 
    ```
    javascript:(function(){var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/gh/propadiene-1/dfjk-leaderboard@main/content.js';document.body.appendChild(s);})();
    ```

3. Open the game and click the bookmark :D

### Configuration

If you want to use your own board, change the `SUPABASE_URL` / `SUPABASE_KEY` variables at the top of `content.js`.

Score table setup for Supabase (run in SQL Editor):

```sql
create table scores (
  id          bigint generated always as identity primary key,
  chart_id    int    not null,
  username    text   not null check (char_length(username) between 1 and 20),
  time_ms     int    not null check (time_ms > 0),
  accuracy    real   not null,
  cps         real   not null,
  created_at  timestamptz default now()
);
create index scores_chart_time_idx on scores (chart_id, time_ms);

grant select, insert on public.scores to anon;

alter table scores enable row level security;
create policy read_all   on scores for select using (true);
create policy insert_sane on scores for insert with check (
  cps < 20 and time_ms > 1000 and char_length(username) <= 20
);
```