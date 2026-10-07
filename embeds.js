const { EmbedBuilder } = require('discord.js');
const config = require('./config');

const COLORS = {
  main: 0x006c35, // Saudi green
  goal: 0x2ecc71,
  red: 0xe74c3c,
  warn: 0xf1c40f,
  info: 0x3498db,
};

// Every embed starts here, so the developer credit is ALWAYS in the footer.
function base(color = COLORS.main) {
  return new EmbedBuilder()
    .setColor(color)
    .setFooter({ text: config.CREDIT })
    .setTimestamp();
}

function withLeague(embed, f) {
  const name = f.league?.name || 'مباراة';
  const author = { name: f.league?.round ? `${name} • ${f.league.round}` : name };
  if (f.league?.logo) author.iconURL = f.league.logo;
  return embed.setAuthor(author);
}

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

function scheduleEmbed(fixtures, dateLabel) {
  const lines = fixtures.slice(0, 20).map(
    (f) =>
      `<t:${f.fixture.timestamp}:t> — **${f.teams.home.name}** × **${f.teams.away.name}**\n└ 🏆 ${f.league.name}`
  );
  return base(COLORS.main)
    .setTitle(`📅 مباريات اليوم — ${dateLabel}`)
    .setDescription(`${lines.join('\n\n')}\n\n*الأوقات تظهر بتوقيتك المحلي*`.slice(0, 4000));
}

function reminderEmbed(f) {
  const e = base(COLORS.info)
    .setTitle('⏰ مباراة قريبة!')
    .setDescription(`**${f.teams.home.name}** × **${f.teams.away.name}**\nتنطلق <t:${f.fixture.timestamp}:R> (<t:${f.fixture.timestamp}:t>)`);
  if (f.fixture.venue?.name) e.addFields({ name: '🏟️ الملعب', value: f.fixture.venue.name, inline: true });
  return withLeague(e, f);
}

function kickoffEmbed(f) {
  const e = base(COLORS.main).setTitle('🟢 انطلقت المباراة!').setDescription(scoreLine(f));
  if (f.fixture.venue?.name) e.addFields({ name: '🏟️ الملعب', value: f.fixture.venue.name, inline: true });
  return withLeague(e, f);
}

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
  if (ev.team?.logo) e.setThumbnail(ev.team.logo);
  return withLeague(e, f);
}

function halftimeEmbed(f, events) {
  const e = base(COLORS.warn).setTitle('⏸️ نهاية الشوط الأول').setDescription(scoreLine(f));
  const goals = goalsList(events);
  if (goals) e.addFields({ name: 'الأهداف', value: goals });
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
  return withLeague(e, f);
}

module.exports = {
  COLORS,
  scheduleEmbed,
  reminderEmbed,
  kickoffEmbed,
  eventEmbed,
  halftimeEmbed,
  fulltimeEmbed,
};
