const { Client, GatewayIntentBits, ActivityType, Events, PermissionFlagsBits } = require('discord.js');
const cron = require('node-cron');
const express = require('express');
const config = require('./config');
const matcher = require('./matcher');
const tracker = require('./tracker');
const embeds = require('./embeds');

const testMode = process.argv.includes('--test');

// ---- Tiny web server (keeps free hosts like Render/Railway happy). Started first so health checks pass. ----
const app = express();
app.get('/', (req, res) => res.send('Koora Bot is running 24/7!'));
app.listen(process.env.PORT || 3000, () => console.log(`🌐 Web server listening on port ${process.env.PORT || 3000}`));

// ---- Validate cron expressions up front ----
for (const [name, expr] of [
  ['POLL_CRON', config.pollCron],
  ['DAILY_CRON', config.dailyCron],
  ['SCHEDULE_REFRESH_CRON', config.scheduleRefreshCron],
  ['NEWS_CRON', config.news.cron],
]) {
  if (!cron.validate(expr)) {
    console.error(`❌ Invalid cron expression in ${name}: "${expr}"`);
    process.exit(1);
  }
}

// ---- Discord client (presence is re-applied automatically on every reconnect) ----
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  presence: {
    status: 'online',
    activities: [{ name: config.CREDIT, type: ActivityType.Watching }],
  },
});

const channels = new Map();

async function getChannel(id) {
  if (channels.has(id)) return channels.get(id);
  const channel = await client.channels.fetch(id);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Channel ${id} was not found or is not a text channel`);
  }
  channels.set(id, channel);
  return channel;
}

// Returns true only if Discord accepted the message.
async function sendTo(channelId, embed) {
  try {
    const channel = await getChannel(channelId);
    await channel.send({ embeds: [embed] });
    return true;
  } catch (err) {
    channels.delete(channelId);
    console.error(`❌ Failed to send embed to ${channelId}:`, err.message, err.code ? `(Discord code ${err.code})` : '');
    return false;
  }
}
const send = (embed) => sendTo(config.channelId, embed);
const sendNews = (embed) => sendTo(config.newsChannelId, embed);

// ---- Startup diagnostics: tell the owner EXACTLY why the bot would be silent ----
async function diagnose() {
  for (const id of new Set([config.channelId, config.newsChannelId])) {
    try {
      const ch = await getChannel(id);
      if (ch.guild) {
        const perms = ch.permissionsFor(client.user);
        const need = { ViewChannel: PermissionFlagsBits.ViewChannel, SendMessages: PermissionFlagsBits.SendMessages, EmbedLinks: PermissionFlagsBits.EmbedLinks };
        const lacking = Object.entries(need).filter(([, bit]) => !perms?.has(bit)).map(([n]) => n);
        console.log(lacking.length ? `❌ Channel ${id} (#${ch.name}): bot is missing permissions: ${lacking.join(', ')}` : `✅ Channel ${id} (#${ch.name}): permissions OK`);
      }
    } catch (err) {
      console.error(`❌ Cannot access channel ${id}: ${err.message} -> check CHANNEL_ID and that the bot is in that server`);
    }
  }
  try {
    const st = await matcher.checkApi();
    console.log(`✅ API-Football OK (provider: ${config.api.provider}, plan: ${st.plan}, used today: ${st.used}/${st.limit})`);
    if (st.limit && st.used >= st.limit) console.error('❌ Daily API quota is exhausted: the bot cannot fetch matches until it resets');
  } catch (err) {
    console.error(`❌ API-Football check failed (${config.api.provider}): ${err.message} -> wrong key, wrong API_PROVIDER, or quota exhausted`);
  }
}

// ---- --test mode: posts sample embeds to verify channel, permissions, logos, photos, news ----
async function runTest() {
  const logo = (id) => `https://media.api-sports.io/football/teams/${id}.png`;
  const fixture = {
    fixture: { id: 0, timestamp: Math.floor(Date.now() / 1000) + 3600, status: { short: '2H', elapsed: 67 }, venue: { name: 'Kingdom Arena' } },
    league: { name: 'Roshn Saudi League', round: 'Regular Season - 5', logo: 'https://media.api-sports.io/football/leagues/307.png', country: 'Saudi-Arabia' },
    teams: { home: { id: 2932, name: 'Al Hilal', logo: logo(2932) }, away: { id: 2939, name: 'Al Nassr', logo: logo(2939) } },
    goals: { home: 2, away: 1 },
    score: {},
  };
  const event = {
    time: { elapsed: 67, extra: null },
    team: { id: 2932, name: 'Al Hilal', logo: logo(2932) },
    player: { id: 10, name: 'Salem Al-Dawsari' },
    assist: { id: 11, name: 'Sergej Milinković-Savić' },
    type: 'Goal',
    detail: 'Normal Goal',
  };
  const item = {
    title: 'خبر تجريبي: اختبار نشر أخبار الكرة السعودية',
    link: 'https://example.com',
    summary: 'هذه رسالة اختبار للتأكد من أن قناة الأخبار تعمل.',
    image: '',
    source: 'اختبار',
    sourceUrl: 'https://example.com',
    ts: Date.now(),
  };
  const ok = [
    await send(embeds.eventEmbed(fixture, event)),
    await send(embeds.scheduleEmbed([fixture], 'اختبار')),
    await sendNews(embeds.newsEmbed(item)),
  ];
  console.log(ok.every(Boolean) ? '✅ Test embeds sent.' : '❌ Test failed, check the errors above.');
}

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  await diagnose();

  if (testMode) {
    await runTest();
    await shutdown(0);
    return;
  }

  tracker.init();
  await tracker.refreshSchedule();

  const opts = { timezone: config.timezone };
  cron.schedule(config.pollCron, () => tracker.tick(send), opts); // reminders + live polling
  cron.schedule(config.scheduleRefreshCron, () => tracker.refreshSchedule(), opts);
  cron.schedule(config.dailyCron, () => tracker.postDailySchedule(send), opts);
  if (config.news.enabled) cron.schedule(config.news.cron, () => tracker.newsTick(sendNews), opts);

  console.log(
    `⏱️ Polling: "${config.pollCron}" | Daily: "${config.dailyCron}" | News: ${config.news.enabled ? `"${config.news.cron}" (${config.news.feeds.length} feeds)` : 'off'} | TZ: ${config.timezone}`
  );

  if (config.announceStartup) {
    await send(embeds.statusEmbed('البوت شغّال ومتصل بنجاح'));
  }

  tracker.catchUpDaily(send).catch((e) => console.error('Daily catch-up failed:', e.message));
  tracker.tick(send); // first check immediately on startup
  if (config.news.enabled) tracker.newsTick(sendNews);
});

// ---- Process safety ----
async function shutdown(code = 0) {
  console.log('👋 Shutting down...');
  try {
    await client.destroy();
  } catch (_) {
    /* ignore */
  }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));

client.login(config.discordToken).catch((err) => {
  console.error('❌ Discord login failed:', err.message);
  process.exit(1);
});
