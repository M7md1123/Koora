const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const CREDIT = 'تم التطوير بواسطة محمد الخثعمي | AL0 Lab';

// ---- Validate required variables early with a clear message ----
const required = ['DISCORD_TOKEN', 'API_FOOTBALL_KEY', 'CHANNEL_ID'];
const missing = required.filter((key) => {
  const v = process.env[key];
  return !v || v.trim() === '' || v.startsWith('PASTE_');
});
if (missing.length) {
  console.error(`❌ Missing or unfilled variables in .env: ${missing.join(', ')}`);
  process.exit(1);
}

const parseIds = (value, fallback) =>
  (value ?? fallback)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

// ---- API provider (RapidAPI vs direct api-sports.io) ----
const provider = (process.env.API_PROVIDER || 'rapidapi').toLowerCase();
const key = process.env.API_FOOTBALL_KEY.trim();

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

module.exports = {
  CREDIT,
  discordToken: process.env.DISCORD_TOKEN.trim(),
  channelId: process.env.CHANNEL_ID.trim(),
  api,
  leagueIds: parseIds(process.env.LEAGUE_IDS, '307,504'),
  teamIds: parseIds(process.env.TEAM_IDS, '23'),
  timezone: process.env.TIMEZONE || 'Asia/Riyadh',
  pollCron: process.env.POLL_CRON || '* * * * *',
  dailyCron: process.env.DAILY_CRON || '0 8 * * *',
  scheduleRefreshCron: process.env.SCHEDULE_REFRESH_CRON || '0 */2 * * *',
  reminderMinutes: Number(process.env.REMINDER_MINUTES) || 30,
  stateFile: path.join(__dirname, 'data', 'state.json'),
};
