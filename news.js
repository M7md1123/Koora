// Saudi football news from RSS/Atom feeds. No extra dependencies: tiny built-in parser.
const axios = require('axios');
const config = require('./config');

const http = axios.create({
  timeout: 15000,
  maxRedirects: 5,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KooraBot/1.0)', Accept: 'application/rss+xml, application/xml, text/xml, text/html;q=0.8' },
});

const decode = (s = '') =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');

const strip = (s = '') => decode(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};
const attr = (block, name, a) => {
  const m = block.match(new RegExp(`<${name}\\s[^>]*?${a}=["']([^"']+)["']`, 'i'));
  return m ? decode(m[1]) : '';
};

const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

function parseFeed(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map((b) => {
    const link = strip(tag(b, 'link')) || attr(b, 'link', 'href');
    const desc = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content');
    const descHtml = decode(desc);
    const imgInDesc = (descHtml.match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1];
    const image =
      attr(b, 'media:content', 'url') ||
      attr(b, 'media:thumbnail', 'url') ||
      attr(b, 'enclosure', 'url') ||
      imgInDesc ||
      '';
    const sourceName = strip(tag(b, 'source'));
    const sourceUrl = attr(b, 'source', 'url');
    let title = strip(tag(b, 'title'));
    // Google News appends " - Publisher" to titles
    if (sourceName && title.endsWith(` - ${sourceName}`)) title = title.slice(0, -(sourceName.length + 3)).trim();
    const dateStr = strip(tag(b, 'pubDate')) || strip(tag(b, 'published')) || strip(tag(b, 'updated'));
    const ts = Date.parse(dateStr);
    // Google descriptions just repeat the title + source, so don't use them as summary
    let summary = strip(descHtml);
    if (!summary || summary.startsWith(title) || summary.length < 25) summary = '';
    return {
      id: strip(tag(b, 'guid')) || strip(tag(b, 'id')) || link,
      title,
      link,
      summary: summary.slice(0, 300),
      image: isHttp(image) ? image : '',
      source: sourceName || '',
      sourceUrl,
      ts: Number.isFinite(ts) ? ts : Date.now(),
    };
  }).filter((i) => i.title && isHttp(i.link));
}

async function fetchFeed(url) {
  try {
    const res = await http.get(url, { responseType: 'text' });
    return parseFeed(String(res.data));
  } catch (err) {
    console.error(`⚠️ News feed failed (${new URL(url).hostname}):`, err.message);
    return [];
  }
}

// Try to grab og:image from the article page (works for direct publisher links, not Google redirect links).
async function fetchOgImage(link) {
  try {
    if (/news\.google\.com/.test(link)) return '';
    const res = await http.get(link, { responseType: 'text', timeout: 8000, maxContentLength: 1.5 * 1024 * 1024 });
    const html = String(res.data);
    const m =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const url = m ? decode(m[1]) : '';
    return isHttp(url) ? url : '';
  } catch (_) {
    return '';
  }
}

const normTitle = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// All fresh items from all feeds, newest first, de-duplicated by link and by (near-)identical title.
async function fetchLatest() {
  const lists = await Promise.all(config.news.feeds.map(fetchFeed));
  const maxAge = config.news.maxAgeHours * 3600 * 1000;
  const seen = new Set();
  const out = [];
  for (const item of lists.flat().sort((a, b) => b.ts - a.ts)) {
    if (Date.now() - item.ts > maxAge) continue;
    const key = normTitle(item.title).slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, titleKey: key });
  }
  return out;
}

module.exports = { fetchLatest, fetchOgImage, parseFeed };
