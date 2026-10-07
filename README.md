# Saudi Football Discord Bot

Live scores, goals, red cards, reminders and daily schedules for the Roshn Saudi League, King's Cup and the Saudi national team.

> تم التطوير بواسطة محمد الخثعمي | AL0 Lab

## 1. Setup

1. **Discord bot**: https://discord.com/developers/applications -> New Application -> Bot -> *Reset Token* (copy it).
   No privileged intents are needed.
2. **Invite it**: OAuth2 -> URL Generator -> scope `bot` -> permissions **View Channel, Send Messages, Embed Links**.
3. **Channel ID**: Discord Settings -> Advanced -> Developer Mode ON -> right-click the channel -> Copy Channel ID.
4. **API-Football key**: RapidAPI (`API_PROVIDER=rapidapi`) or the api-sports.io dashboard (`API_PROVIDER=direct`).
5. Fill in `.env` (`DISCORD_TOKEN`, `API_FOOTBALL_KEY`, `CHANNEL_ID`).
6. Verify the IDs for your plan/season (defaults: league `307` Saudi Pro League, `504` King's Cup, team `23` Saudi Arabia):
   `GET /leagues?search=saudi` and `GET /teams?search=saudi`

```bash
npm install
npm run test-embed   # posts sample embeds, checks channel + permissions + footer
npm start
```

## 2. How it works

| File | Role |
|---|---|
| `index.js` | Discord client, presence, cron schedules, graceful shutdown |
| `matcher.js` | API-Football requests (live, by date, by id, events) |
| `tracker.js` | State + event detection + duplicate prevention (`data/state.json`) |
| `embeds.js` | All embeds, each with the developer credit footer |
| `config.js` | `.env` loading and validation |

- One `fixtures?live=all` request per poll, filtered locally to your leagues/teams.
- The bot only polls when a tracked match is about to start / in progress (saves quota).
- Every posted goal/card/kickoff/HT/FT is recorded in `data/state.json`, so restarts never re-post.
- If the bot starts mid-match with no state, old events are marked silently, only new ones are posted.

## 3. Run 24/7

**VPS (recommended) with PM2**
```bash
npm install -g pm2
pm2 start index.js --name saudi-football-bot
pm2 save
pm2 startup        # run the command it prints
pm2 logs saudi-football-bot
```

**Railway / Render / Docker**: set the three variables in the dashboard instead of the `.env`
file and attach a persistent volume for `data/` so `state.json` survives redeploys.

## 4. API quota

Live polling uses about 1 request per minute while matches are on (roughly 100+ per match).
The free plan (100/day) is not enough for every-minute polling; use a paid plan or set
`POLL_CRON=*/2 * * * *`.

## 5. Troubleshooting

- `Missing or unfilled variables`: a value in `.env` is empty or still starts with `PASTE_`.
- `Failed to send embed`: wrong channel ID, or the bot lacks View Channel / Send Messages / Embed Links.
- `API-Football error`: invalid key, wrong `API_PROVIDER`, or quota exhausted.
- Nothing posts: no tracked match is live. Check the `📅 Schedule refreshed` log line.
