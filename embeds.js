const { EmbedBuilder } = require('discord.js');
const config = require('./config');

const COLORS = {
  main: 0x006c35, // Saudi green
  goal: 0x2ecc71,
  red: 0xe74c3c,
  warn: 0xf1c40f,
  info: 0x3498db,
  news: 0x1abc9c,
};

const isUrl = (u) => typeof u === 'string' && /^https?:\/\/\S+$/i.test(u);
// API-Football player photos live on the media CDN and need no key.
const playerPhoto = (p) => (p?.id ? `https://media.api-sports.io/football/players/${p.id}.png` : null);

// Every embed starts here, so the developer credit is ALWAYS in the footer.
function base(color = COLORS.main) {
  return new EmbedBuilder().setColor(color).setFooter({ text: config.CREDIT }).setTimestamp();
}

// League name + league logo at the top of the embed
function withLeague(embed, f) {
  const name = f.league?.name || 'مباراة';
  const author = { name: f.league?.round ? `${name} • ${f.league.round}`.slice(0, 256) : name.slice(0, 256) };
  if (isUrl(f.league?.logo)) author.iconURL = f.league.logo;
  return embed.setAuthor(author);
}

const thumb = (embed, url) => (isUrl(url) ? embed.setThumbnail(url) : embed);

const scoreLine = (f) =>
  `**${f.teams.home.name}**  ${f.goals.home ?? 0} - ${f.goals.away ?? 0}  **${f.teams.away.name}**`;

const fmtMinute = (t) => {
  if (!t || t.elapsed == null) return '—';
  return `${t.elapsed}${t.extra ? `+${t.extra}` : ''}'`;
};

function goalsList(events) {
  const goals = (events || []).filter(
    (e) => e.type === 'Goal' && (e.detail || '').toLowerCase() !== 'missed penalty'
  );
  if (!goals.length) return null;
  return goals
    .map((e) => {
      const d = (e.detail || '').toLowerCase();
      const tag = d === 'own goal' ? ' (عكسي)' : d === 'penalty' ? ' (ركلة جزاء)' : '';
      return `⚽ ${fmtMinute(e.time)} ${e.player?.name || '—'}${tag} — ${e.team?.name || ''}`;
    })
    .join('\n')
    .slice(0, 1000);
}

// ---------- Embeds ----------

// Grouped by league; league logo of the first group is the thumbnail.
function scheduleEmbed(fixtures, dateLabel) {
  const groups = new Map();
  for (const f of fixtures.slice(0, 30)) {
    const key = f.league?.name || 'مباريات';
    if (!groups.has(key)) groups.set(key, { logo: f.league?.logo, list: [] });
    groups.get(key).list.push(f);
  }
  const e = base(COLORS.main).setTitle(`📅 مباريات اليوم — ${dateLabel}`.slice(0, 256));
  let i = 0;
  for (const [name, g] of groups) {
    if (i++ >= 20) break;
    const value = g.list
      .map((f) => `<t:${f.fixture.timestamp}:t> — **${f.teams.home.name}** × **${f.teams.away.name}**`)
      .join('\n')
      .slice(0, 1024);
    e.addFields({ name: `🏆 ${name}`.slice(0, 256), value });
  }
  const first = groups.values().next().value;
  if (first) thumb(e, first.logo);
  e.setDescription('*الأوقات تظهر بتوقيتك المحلي*');
  return e;
}

function reminderEmbed(f) {
  const e = base(COLORS.info)
    .setTitle('⏰ مباراة قريبة!')
    .setDescription(
      `**${f.teams.home.name}** × **${f.teams.away.name}**\nتنطلق <t:${f.fixture.timestamp}:R> (<t:${f.fixture.timestamp}:t>)`
    );
  if (f.fixture.venue?.name) e.addFields({ name: '🏟️ الملعب', value: f.fixture.venue.name, inline: true });
  thumb(e, f.teams?.home?.logo);
  return withLeague(e, f);
}

function kickoffEmbed(f) {
  const e = base(COLORS.main).setTitle('🟢 انطلقت المباراة!').setDescription(scoreLine(f));
  if (f.fixture.venue?.name) e.addFields({ name: '🏟️ الملعب', value: f.fixture.venue.name, inline: true });
  thumb(e, f.teams?.home?.logo);
  return withLeague(e, f);
}

// Goal / card / VAR: thumbnail = player photo (fallback: team logo), footer icon = team logo
function eventEmbed(f, ev) {
  const type = ev.type;
  const detail = (ev.detail || '').toLowerCase();
  let color = COLORS.goal;
  let heading = '⚽ جووول!';

  if (type === 'Goal' && detail === 'missed penalty') {
    color = COLORS.warn;
    heading = '❌ ركلة جزاء ضائعة';
  } else if (type === 'Goal') {
    heading = detail === 'own goal' ? '😬 هدف عكسي' : detail === 'penalty' ? '⚽ جووول من ركلة جزاء!' : '⚽ جووول!';
  } else if (type === 'Card') {
    color = COLORS.red;
    heading = detail.includes('second yellow') ? '🟨🟥 إنذار ثانٍ (طرد)' : '🟥 بطاقة حمراء';
  } else if (type === 'Var') {
    color = COLORS.warn;
    heading = '📺 VAR: تم إلغاء الهدف';
  }

  const e = base(color)
    .setTitle(heading)
    .setDescription(scoreLine(f))
    .addFields(
      { name: 'اللاعب', value: ev.player?.name || '—', inline: true },
      { name: 'الفريق', value: ev.team?.name || '—', inline: true },
      { name: 'الدقيقة', value: fmtMinute(ev.time), inline: true }
    );
  if (ev.assist?.name) e.addFields({ name: '🅰️ صناعة الهدف', value: ev.assist.name, inline: true });

  thumb(e, playerPhoto(ev.player) || ev.team?.logo);
  if (isUrl(ev.team?.logo)) e.setFooter({ text: config.CREDIT, iconURL: ev.team.logo });
  return withLeague(e, f);
}

function halftimeEmbed(f, events) {
  const e = base(COLORS.warn).setTitle('⏸️ نهاية الشوط الأول').setDescription(scoreLine(f));
  const goals = goalsList(events);
  if (goals) e.addFields({ name: 'الأهداف', value: goals });
  thumb(e, f.teams?.home?.logo);
  return withLeague(e, f);
}

function fulltimeEmbed(f, events) {
  const short = f.fixture.status.short;
  let note = '';
  if (short === 'AET') note = '\n*بعد الوقت الإضافي*';
  if (short === 'PEN') note = `\n*ركلات الترجيح: ${f.score?.penalty?.home ?? '-'} - ${f.score?.penalty?.away ?? '-'}*`;
  const e = base(COLORS.info).setTitle('🏁 نهاية المباراة').setDescription(scoreLine(f) + note);
  const goals = goalsList(events);
  if (goals) e.addFields({ name: 'الأهداف', value: goals });
  thumb(e, f.teams?.home?.logo);
  return withLeague(e, f);
}

// News: title links to the article; image = article picture if found, else publisher favicon as thumbnail
function newsEmbed(item) {
  const e = base(COLORS.news)
    .setTitle(`📰 ${item.title}`.slice(0, 256))
    .setURL(item.link)
    .setTimestamp(new Date(item.ts));
  if (item.summary) e.setDescription(item.summary.slice(0, 400));
  e.setAuthor({ name: item.source ? `أخبار الكرة السعودية • ${item.source}`.slice(0, 256) : 'أخبار الكرة السعودية' });
  if (isUrl(item.image)) {
    e.setImage(item.image);
  } else if (item.sourceUrl) {
    try {
      e.setThumbnail(`https://www.google.com/s2/favicons?domain=${new URL(item.sourceUrl).hostname}&sz=128`);
    } catch (_) { /* ignore bad url */ }
  }
  return e;
}

function statusEmbed(text) {
  return base(COLORS.main).setTitle('✅ البوت متصل').setDescription(text);
}

module.exports = {
  COLORS,
  statusEmbed,
  scheduleEmbed,
  reminderEmbed,
  kickoffEmbed,
  eventEmbed,
  halftimeEmbed,
  fulltimeEmbed,
  newsEmbed,
};
