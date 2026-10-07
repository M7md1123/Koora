const { Client, GatewayIntentBits, ActivityType, Events } = require('discord.js');
const cron = require('node-cron');
const config = require('./config');
const tracker = require('./tracker');
const embeds = require('./embeds');

const testMode = process.argv.includes('--test');

// ---- Validate cron expressions up front ----
for (const [name, expr] of [
  ['POLL_CRON', config.pollCron],
  ['DAILY_CRON', config.dailyCron],
  ['SCHEDULE_REFRESH_CRON', config.scheduleRefreshCron],
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

let channelCache = null;

async function getChannel() {
  if (channelCache) return channelCache;
  const channel = await client.channels.fetch(config.channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Channel ${config.channelId} was not found or is not a text channel`);
  }
  channelCache = channel;
  return channel;
}

// Used by the tracker. Returns true only if Discord accepted the message.
async function send(embed) {
  try {
    const channel = await getChannel();
    await channel.send({ embeds: [embed] });
    return true;
  } catch (err) {
    channelCache = null;
    console.error('❌ Failed to send embed:', err.message);
    return false;
  }
}

// ---- --test mode: posts sample embeds to verify channel, permissions and footer ----
async function runTest() {
  const fixture = {
    fixture: { id: 0, timestamp: Math.floor(Date.now() / 1000) + 3600, status: { short: '2H', elapsed: 67 }, venue: { name: 'Kingdom Arena' } },
    league: { name: 'Roshn Saudi League', round: 'Regular Season - 5', logo: '' },
    teams: { home: { id: 1, name: 'Al Hilal', logo: '' }, away: { id: 2, name: 'Al Nassr', logo: '' } },
    goals: { home: 2, away: 1 },
    score: {},
  };
  const event = {
    time: { elapsed: 67, extra: null },
    team: { id: 1, name: 'Al Hilal', logo: '' },
    player: { id: 10, name: 'Salem Al-Dawsari' },
    assist: { id: 11, name: 'Sergej Milinković-Savić' },
    type: 'Goal',
    detail: 'Normal Goal',
  };
  const ok1 = await send(embeds.eventEmbed(fixture, event));
  const ok2 = await send(embeds.scheduleEmbed([fixture], 'اختبار'));
  console.log(ok1 && ok2 ? '✅ Test embeds sent.' : '❌ Test failed, check the errors above.');
}

client.once(Events.ClientReady, async (c) => {
    console.log(`✅ Logged in as ${c.user.tag}`);

    // أضف هذا السطر هنا ليقوم بإرسال رسالة تجريبية فوراً عند التشغيل
    await send(embeds.scheduleEmbed([{
        fixture: { id: 0, timestamp: Math.floor(Date.now() / 1000) + 3600, status: { short: '2H', elapsed: 67 }, venue: { name: 'Kingdom Arena' } },
        league: { name: 'Koora Bot Ready', round: 'Live Test', logo: '' },
        teams: { home: { id: 1, name: 'Al Hilal', logo: '' }, away: { id: 2, name: 'Al Nassr', logo: '' } },
        goals: { home: 2, away: 1 },
        score: {},
    }], 'البوت شغال ومتصل بنجاح!'));

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

  console.log(`⏱️ Polling: "${config.pollCron}" | Daily post: "${config.dailyCron}" | TZ: ${config.timezone}`);
  tracker.tick(send); // first check immediately on startup
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

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Koora Bot is running 24/7!');
});

app.listen(PORT, () => {
  console.log(`Web server is listening on port ${PORT}`);
});
