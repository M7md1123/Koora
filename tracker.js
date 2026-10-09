const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const matcher = require('./matcher');
const embeds = require('./embeds');
const news = require('./news');

const { FINISHED_STATUSES: FINISHED, DEAD_STATUSES: DEAD } = matcher;

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_ACTIVE_MS = 6 * 60 * 60 * 1000;

// state.events : posted event keys      -> timestamp
// state.flags  : one-time notifications -> timestamp (kickoff, ht, ft, reminder, daily, seen)
// state.active : fixtures currently being followed -> last time seen live
// state.news   : posted news keys     -> timestamp
let state = { events: {}, flags: {}, active: {}, news: {} };
let scheduleLoadedAt = 0; // 0 = schedule never loaded successfully
let scheduleCache = [];
let running = false;

// ---------- State persistence (survives restarts, so nothing is posted twice) ----------

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(config.stateFile, 'utf8'));
    state = { events: raw.events || {}, flags: raw.flags || {}, active: raw.active || {}, news: raw.news || {} };
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('⚠️ Could not read state file, starting fresh:', err.message);
  }
  const cutoff = Date.now() - RETENTION_MS;
  for (const bucket of ['events', 'flags', 'active', 'news']) {
    for (const [k, v] of Object.entries(state[bucket])) {
      if (v < cutoff) delete state[bucket][k];
    }
  }
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
    const tmp = `${config.stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, config.stateFile); // atomic write
  } catch (err) {
    console.error('❌ Failed to save state:', err.message);
  }
}

// Send an embed only once per key. The key is recorded ONLY if Discord accepted the message,
// so a failed send is retried on the next poll instead of being lost.
async function sendOnce(send, key, build, bucket = 'flags') {
  if (state[bucket][key]) return false;
  const ok = await send(build());
  if (ok) {
    state[bucket][key] = Date.now();
    saveState();
  }
  return ok;
}

// ---------- Helpers ----------

const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: config.timezone });

function isNotable(ev) {
  const type = ev.type;
  const d = (ev.detail || '').toLowerCase();
  if (type === 'Goal') return true; // normal, own goal, penalty, missed penalty
  if (type === 'Card') return d.includes('red') || d.includes('second yellow');
  if (type === 'Var') return d.includes('goal cancelled') || d.includes('disallowed');
  return false;
}

function eventKey(fixtureId, ev) {
  return [
    fixtureId,
    ev.type,
    ev.detail,
    ev.team?.id,
    ev.player?.id ?? ev.player?.name,
    ev.time?.elapsed,
    ev.time?.extra ?? 0,
  ].join('|');
}

// ---------- Schedule ----------

async function refreshSchedule() {
  try {
    await matcher.loadSaudiTeams();
    const fixtures = await matcher.getFixturesByDate(todayStr());
    scheduleCache = fixtures.sort((a, b) => a.fixture.timestamp - b.fixture.timestamp);
    scheduleLoadedAt = Date.now();
    console.log(`📅 Schedule refreshed: ${scheduleCache.length} tracked match(es) today`);
  } catch (err) {
    console.error('❌ Schedule refresh failed (keeping old cache):', err.message);
  }
}

async function postDailySchedule(send) {
  await refreshSchedule();
  const list = scheduleCache.filter((f) => !DEAD.includes(f.fixture.status.short));
  if (!list.length) {
    console.log('ℹ️ No tracked matches today, skipping daily post.');
    return;
  }
  await sendOnce(send, `daily:${todayStr()}`, () => embeds.scheduleEmbed(list, todayStr()));
}

async function checkReminders(send) {
  const now = Math.floor(Date.now() / 1000);
  for (const f of scheduleCache) {
    if (f.fixture.status.short !== 'NS') continue;
    const diff = f.fixture.timestamp - now;
    if (diff > 0 && diff <= config.reminderMinutes * 60) {
      await sendOnce(send, `reminder:${f.fixture.id}`, () => embeds.reminderEmbed(f));
    }
  }
}

// Only call the live endpoint when it makes sense (saves API quota):
//  - a followed match is still active, or
//  - a tracked match is about to start / probably still running, or
//  - the schedule never loaded (fail-open: better to poll than to stay silent).
function shouldPoll() {
  if (config.alwaysPoll) return true;
  if (Object.keys(state.active).length) return true;
  if (!scheduleLoadedAt) return true;
  const now = Math.floor(Date.now() / 1000);
  const lead = config.pollLeadMinutes * 60;
  const tail = config.pollTailMinutes * 60;
  return scheduleCache.some((f) => {
    const t = f.fixture.timestamp;
    return now >= t - lead && now <= t + tail && !DEAD.includes(f.fixture.status.short);
  });
}

// ---------- Live handling ----------

async function handleFixture(f, send) {
  const id = f.fixture.id;
  const short = f.fixture.status.short;
  const elapsed = f.fixture.status.elapsed ?? 0;
  const finished = FINISHED.includes(short);
  const events = Array.isArray(f.events) ? f.events : await matcher.getFixtureEvents(id);

  if (!finished) state.active[id] = Date.now();

  // First time we see this match: if the bot joined late (restart/no state), silently
  // mark what already happened so we don't spam old goals.
  if (!state.flags[`seen:${id}`]) {
    state.flags[`seen:${id}`] = Date.now();
    const lateJoin = elapsed > 3 || short !== '1H';
    if (lateJoin) {
      for (const ev of events) {
        if (isNotable(ev)) state.events[eventKey(id, ev)] = Date.now();
      }
      state.flags[`kickoff:${id}`] = Date.now();
      if (['2H', 'ET', 'BT', 'P'].includes(short) || finished) state.flags[`ht:${id}`] = Date.now();
    }
    saveState();
  }

  if (short === '1H') {
    await sendOnce(send, `kickoff:${id}`, () => embeds.kickoffEmbed(f));
  }

  for (const ev of events) {
    if (!isNotable(ev)) continue;
    await sendOnce(send, eventKey(id, ev), () => embeds.eventEmbed(f, ev), 'events');
  }

  if (short === 'HT') {
    await sendOnce(send, `ht:${id}`, () => embeds.halftimeEmbed(f, events));
  }

  if (finished) {
    const ok = await sendOnce(send, `ft:${id}`, () => embeds.fulltimeEmbed(f, events));
    if (ok || state.flags[`ft:${id}`]) {
      delete state.active[id];
      saveState();
    }
  }
}

async function pollLive(send) {
  const live = await matcher.getLiveFixtures();
  const liveIds = new Set(live.map((f) => String(f.fixture.id)));

  for (const f of live) await handleFixture(f, send);

  // Matches we were following that are no longer "live" -> they finished (or glitched). Check them.
  for (const id of Object.keys(state.active)) {
    if (liveIds.has(id)) continue;
    const f = await matcher.getFixtureById(id);
    if (!f) continue;
    const st = f.fixture.status.short;
    if (FINISHED.includes(st)) {
      await handleFixture(f, send);
    } else if (DEAD.includes(st) || Date.now() - state.active[id] > STALE_ACTIVE_MS) {
      delete state.active[id];
    }
    // otherwise the API had a brief gap: keep following
  }
  saveState();
}

// ---------- News ----------

const newsKeys = (item) => [
  `link:${crypto.createHash('md5').update(item.id || item.link).digest('hex')}`,
  `title:${item.titleKey}`,
];
const isNewsSeen = (item) => newsKeys(item).some((k) => state.news[k]);
const markNews = (item) => newsKeys(item).forEach((k) => (state.news[k] = Date.now()));

// Posts the newest unseen items (max NEWS_MAX_PER_RUN per run, oldest first). Older unseen items are
// marked as seen without posting so a first run / long downtime never floods the channel.
async function postNews(sendNews) {
  if (!config.news.enabled) return;
  const items = await news.fetchLatest();
  const fresh = items.filter((i) => !isNewsSeen(i));
  if (!fresh.length) return;

  const toPost = fresh.slice(0, config.news.maxPerRun).reverse(); // fresh is newest-first
  const skipped = fresh.slice(config.news.maxPerRun);
  skipped.forEach(markNews);

  let sent = 0;
  for (const item of toPost) {
    if (!item.image) item.image = await news.fetchOgImage(item.link);
    const ok = await sendNews(embeds.newsEmbed(item));
    if (!ok) break; // retry next run
    markNews(item);
    sent++;
  }
  saveState();
  console.log(`📰 News: ${sent} posted, ${skipped.length} skipped, ${fresh.length - skipped.length - sent} pending retry`);
}

let newsRunning = false;
async function newsTick(sendNews) {
  if (newsRunning) return;
  newsRunning = true;
  try {
    await postNews(sendNews);
  } catch (err) {
    console.error('❌ News cycle failed:', err.message);
  } finally {
    newsRunning = false;
  }
}

// If the bot starts after the daily time (restart / late deploy) and today's post is missing, post it now.
async function catchUpDaily(send) {
  const [minField, hourField] = config.dailyCron.trim().split(/\s+/);
  const hh = Number.isFinite(Number(hourField)) ? Number(hourField) : 8;
  const mm = Number.isFinite(Number(minField)) ? Number(minField) : 0;
  const nowParts = new Date().toLocaleTimeString('en-GB', { timeZone: config.timezone, hour12: false }).split(':').map(Number);
  const pastDaily = nowParts[0] * 60 + nowParts[1] >= hh * 60 + mm;
  if (pastDaily && !state.flags[`daily:${todayStr()}`]) await postDailySchedule(send);
}

// ---------- Entry points used by index.js ----------

function init() {
  loadState();
  console.log(`💾 State loaded (${Object.keys(state.events).length} events, ${Object.keys(state.active).length} active matches)`);
}

async function tick(send) {
  if (running) return; // never let two polls overlap
  running = true;
  try {
    await checkReminders(send);
    if (shouldPoll()) await pollLive(send);
  } catch (err) {
    console.error('❌ Poll cycle failed:', err.message);
  } finally {
    running = false;
  }
}

module.exports = { init, refreshSchedule, postDailySchedule, catchUpDaily, tick, newsTick };
