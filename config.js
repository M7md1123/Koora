const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const CREDIT = 'تم التطوير بواسطة محمد الخثعمي | AL0 Lab';

// ---- Validate required variables early with a clear message ----
const required = ['DISCORD_TOKEN', 'API_FOOTBALL_KEY', 'CHANNEL_ID'];
const missing = required.filter((key) => {
  const v = process.env[key];
  return !v || v.trim() === '' || v.trim().startsWith('PASTE_');
});
if (missing.length) {
  console.error(`❌ Missing or unfilled variables (.env or hosting dashboard): ${missing.join(', ')}`);
  process.exit(1);
}

const parseIds = (value, fallback) =>
  (value ?? fallback)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

const bool = (v, def) => (v === undefined || v === '' ? def : !['false', '0', 'no', 'off'].includes(String(v).toLowerCase()));

// ---- API provider (RapidAPI vs direct api-sports.io) ----
// API_PROVIDER = rapidapi | direct | auto (default). "auto" detects the key type:
// api-sports.io dashboard keys are 32 hex characters, RapidAPI keys are longer.
const key = process.env.API_FOOTBALL_KEY.trim();
let provider = (process.env.API_PROVIDER || 'auto').toLowerCase();
if (provider === 'auto') provider = /^[a-f0-9]{32}$/i.test(key) ? 'direct' : 'rapidapi';

const api =
  provider === 'direct'
    ? {
        provider,
        baseURL: 'https://v3.football.api-sports.io',
        headers: { 'x-apisports-key': key },
      }
    : {
        provider: 'rapidapi',
        baseURL: 'https://api-football-v1.p.rapidapi.com/v3',
        headers: {
          'X-RapidAPI-Key': key,
          'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com',
        },
      };

// ---- News ----
// Default sources: Google News RSS searches in Arabic (no API key needed).
// Add more RSS/Atom feeds with NEWS_FEEDS (comma-separated URLs).
const gnews = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ar&gl=SA&ceid=SA:ar`;
const defaultFeeds = [
  gnews('الدوري السعودي when:1d'),
  gnews('المنتخب السعودي when:1d'),
  gnews('كأس الملك السعودي OR دوري يلو OR "دوري روشن" when:1d'),
];
const extraFeeds = (process.env.NEWS_FEEDS || '').split(',').map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));

module.exports = {
  CREDIT,
  discordToken: process.env.DISCORD_TOKEN.trim(),
  channelId: process.env.CHANNEL_ID.trim(),
  // Optional: a separate channel for news (falls back to the matches channel)
  newsChannelId: (process.env.NEWS_CHANNEL_ID || '').trim() || process.env.CHANNEL_ID.trim(),
  api,
  leagueIds: parseIds(process.env.LEAGUE_IDS, '307,308,504,509'),
  teamIds: parseIds(process.env.TEAM_IDS, '23'),
  country: process.env.TRACK_COUNTRY || 'Saudi-Arabia', // every league of this country + every club of it in any competition
  timezone: process.env.TIMEZONE || 'Asia/Riyadh',
  pollCron: process.env.POLL_CRON || '* * * * *',
  dailyCron: process.env.DAILY_CRON || '0 8 * * *',
  scheduleRefreshCron: process.env.SCHEDULE_REFRESH_CRON || '0 */2 * * *',
  reminderMinutes: Number(process.env.REMINDER_MINUTES) || 30,
  // Live polling window around a tracked kickoff (minutes)
  pollLeadMinutes: Number(process.env.POLL_LEAD_MINUTES) || 5,
  pollTailMinutes: Number(process.env.POLL_TAIL_MINUTES) || 210,
  // Set ALWAYS_POLL=true to poll every cycle regardless of schedule (burns quota)
  alwaysPoll: bool(process.env.ALWAYS_POLL, false),
  news: {
    enabled: bool(process.env.NEWS_ENABLED, true),
    cron: process.env.NEWS_CRON || '*/10 * * * *',
    feeds: [...defaultFeeds, ...extraFeeds],
    maxPerRun: Number(process.env.NEWS_MAX_PER_RUN) || 3,
    maxAgeHours: Number(process.env.NEWS_MAX_AGE_HOURS) || 24,
  },
  announceStartup: bool(process.env.ANNOUNCE_STARTUP, false),
  stateFile: path.join(__dirname, 'data', 'state.json'),
};
