const axios = require('axios');
const config = require('./config');

const http = axios.create({
  baseURL: config.api.baseURL,
  headers: config.api.headers,
  timeout: 15000,
});

const LIVE_STATUSES = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE'];
const FINISHED_STATUSES = ['FT', 'AET', 'PEN'];
const DEAD_STATUSES = ['PST', 'CANC', 'ABD', 'AWD', 'WO'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hasApiErrors(errors) {
  if (!errors) return false;
  return Array.isArray(errors) ? errors.length > 0 : Object.keys(errors).length > 0;
}

// One GET with a single retry for network problems / 5xx. API-level errors (quota, bad key) don't retry.
async function apiGet(endpoint, params = {}, attempt = 1) {
  try {
    const res = await http.get(endpoint, { params });

    const remaining = res.headers['x-ratelimit-requests-remaining'];
    if (remaining !== undefined && Number(remaining) < 10) {
      console.warn(`⚠️ API-Football requests remaining today: ${remaining}`);
    }

    if (hasApiErrors(res.data.errors)) {
      const err = new Error(`API-Football error: ${JSON.stringify(res.data.errors)}`);
      err.isApiError = true;
      throw err;
    }
    return Array.isArray(res.data.response) ? res.data.response : [];
  } catch (err) {
    const status = err.response?.status;
    const retryable = !err.isApiError && attempt < 2 && (!status || status >= 500);
    if (retryable) {
      await sleep(1500);
      return apiGet(endpoint, params, attempt + 1);
    }
    throw err;
  }
}

// Saudi clubs (any competition: AFC Champions League, Club World Cup...) are discovered once and cached.
let saudiTeamIds = new Set();
let saudiTeamsLoadedAt = 0;
const TEAMS_TTL_MS = 24 * 60 * 60 * 1000;

async function loadSaudiTeams(force = false) {
  if (!force && saudiTeamIds.size && Date.now() - saudiTeamsLoadedAt < TEAMS_TTL_MS) return saudiTeamIds;
  try {
    const rows = await apiGet('/teams', { country: config.country });
    const ids = rows.map((r) => r.team?.id).filter(Boolean);
    if (ids.length) {
      saudiTeamIds = new Set(ids);
      saudiTeamsLoadedAt = Date.now();
      console.log(`🏟️ Loaded ${ids.length} ${config.country} teams for filtering`);
    }
  } catch (err) {
    console.error('⚠️ Could not load Saudi team list (league/country filter still works):', err.message);
  }
  return saudiTeamIds;
}

// A fixture is tracked if it is in a Saudi league/cup, one of our league IDs,
// involves ANY Saudi club (continental games) or one of our extra teams (national team).
function isTracked(f) {
  const country = (f.league?.country || '').toLowerCase().replace(/[^a-z]/g, '');
  if (country.includes('saudi')) return true;
  const home = f.teams?.home?.id;
  const away = f.teams?.away?.id;
  return (
    config.leagueIds.includes(f.league?.id) ||
    config.teamIds.includes(home) ||
    config.teamIds.includes(away) ||
    saudiTeamIds.has(home) ||
    saudiTeamIds.has(away)
  );
}

// Startup diagnostic: confirms the key/provider work and shows quota. /status does not use quota.
async function checkApi() {
  const res = await http.get('/status');
  if (hasApiErrors(res.data.errors)) throw new Error(JSON.stringify(res.data.errors));
  const r = res.data.response || {};
  const req = r.requests || {};
  return { plan: r.subscription?.plan, used: req.current, limit: req.limit_day };
}

// All live matches in ONE request, filtered locally. Live fixtures usually include `events` already.
async function getLiveFixtures() {
  const all = await apiGet('/fixtures', { live: 'all' });
  return all.filter(isTracked);
}

// All fixtures for a date (YYYY-MM-DD, in config.timezone), filtered locally. One request.
async function getFixturesByDate(date) {
  const all = await apiGet('/fixtures', { date, timezone: config.timezone });
  return all.filter(isTracked);
}

async function getFixtureById(id) {
  const [fixture] = await apiGet('/fixtures', { id, timezone: config.timezone });
  return fixture || null;
}

async function getFixtureEvents(id) {
  return apiGet('/fixtures/events', { fixture: id });
}

module.exports = {
  LIVE_STATUSES,
  FINISHED_STATUSES,
  DEAD_STATUSES,
  isTracked,
  loadSaudiTeams,
  checkApi,
  getLiveFixtures,
  getFixturesByDate,
  getFixtureById,
  getFixtureEvents,
};
