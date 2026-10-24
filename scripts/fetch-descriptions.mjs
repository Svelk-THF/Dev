// Pulls the meta description from each nonprofit's website and adds it as the
// body text of its Markdown file (shown on the charity's detail page).
//
//   node scripts/fetch-descriptions.mjs            # do it
//   node scripts/fetch-descriptions.mjs --dry-run  # just report what it would do
//   node scripts/fetch-descriptions.mjs --force    # also replace existing body text
//
// Writes scripts/description-report.csv so you can review every result.
// Skips Facebook pages, files that already have body text, and descriptions
// that are junk (too short, CMS defaults) or just repeat the blurb.

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CONTENT = path.join(ROOT, 'src/content/nonprofits');
const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const CONCURRENCY = 6;
const MIN_LENGTH = 50;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

// Default text that site builders leave in place — not worth showing.
const JUNK = [
  /just another wordpress site/i,
  /^(home|welcome|homepage|index)\b.{0,20}$/i,
  /lorem ipsum/i,
  /powered by|built with|made with (wix|squarespace|weebly|wordpress)/i,
  /this is (my|your) (site|website) description/i,
  /add a description/i,
  /^(wix|squarespace|weebly|godaddy|site123)/i,
  /cookie|javascript (is )?(disabled|required)/i,
  /^\d+$/,
];

async function get(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en-NZ,en;q=0.9' }, redirect: 'follow', signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Read the page using the charset it declares (older sites are often Windows-1252).
async function readHtml(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 4096).toString('latin1');
  const charset =
    (res.headers.get('content-type') ?? '').match(/charset=([\w-]+)/i)?.[1] ??
    head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ??
    'utf-8';
  try {
    return new TextDecoder(charset.toLowerCase()).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®', trade: '™' };
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'))?.[2];

// Prefer the standard description, then Open Graph, then Twitter.
function metaDescription(html) {
  const found = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, 'name') ?? attr(tag, 'property') ?? '').toLowerCase();
    if (['description', 'og:description', 'twitter:description'].includes(key) && !found[key]) {
      const content = attr(tag, 'content');
      if (content) found[key] = content;
    }
  }
  const raw = found['description'] ?? found['og:description'] ?? found['twitter:description'];
  if (!raw) return null;
  return { text: decode(raw).replace(/\s+/g, ' ').trim(), source: Object.keys(found).find((k) => found[k] === raw) };
}

const words = (s) => new Set(s.toLowerCase().match(/[a-zāēīōū]{3,}/g) ?? []);
function overlap(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

// Escape characters Markdown or Astro would otherwise treat as syntax.
const toMarkdown = (s) => s.replace(/</g, '&lt;').replace(/^([#>*+-]|\d+\.)\s/, '\\$1 ');

const files = (await fs.readdir(CONTENT)).filter((f) => f.endsWith('.md'));
const report = [['file', 'result', 'source', 'description', 'website']];

let i = 0;
async function worker() {
  while (i < files.length) {
    const file = files[i++];
    const p = path.join(CONTENT, file);
    const md = await fs.readFile(p, 'utf8');
    const parts = md.match(/^(---\r?\n[\s\S]*?\r?\n---)\r?\n?([\s\S]*)$/);
    if (!parts) { report.push([file, 'skipped: no frontmatter']); continue; }
    const [, frontmatter, body] = parts;
    const site = frontmatter.match(/^website:\s*"?([^"\r\n]+)"?/m)?.[1];
    const blurb = frontmatter.match(/^blurb:\s*"?(.*?)"?\s*$/m)?.[1] ?? '';
    const name = frontmatter.match(/^name:\s*"?(.*?)"?\s*$/m)?.[1] ?? '';
    const row = (result, source = '', text = '') => report.push([file, result, source, text, site ?? '']);

    if (body.trim() && !FORCE) { row('skipped: already has body text'); continue; }
    if (!site) { row('skipped: no website'); continue; }
    if (/facebook\.com/i.test(site)) { row('skipped: facebook page'); continue; }

    try {
      const res = await get(site);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const meta = metaDescription(await readHtml(res));
      if (!meta) { row('no meta description'); continue; }
      const { text, source } = meta;
      if (text.length < MIN_LENGTH) { row('rejected: too short', source, text); continue; }
      if (JUNK.some((re) => re.test(text))) { row('rejected: looks like default/junk text', source, text); continue; }
      if (text.toLowerCase() === name.toLowerCase()) { row('rejected: just the name', source, text); continue; }
      if (overlap(text, blurb) > 0.8) { row('rejected: repeats the blurb', source, text); continue; }

      if (!DRY) await fs.writeFile(p, `${frontmatter}\n\n${toMarkdown(text)}\n`);
      row('saved', source, text);
      console.log(`✓ ${file}`);
    } catch (e) {
      row(`error: ${e.name === 'AbortError' ? 'timed out' : e.message}`);
      console.log(`✗ ${file}  ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

report.sort((a, b) => (a[0] === 'file' ? -1 : b[0] === 'file' ? 1 : a[1].localeCompare(b[1]) || a[0].localeCompare(b[0])));
const csv = report.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
await fs.writeFile(path.join(ROOT, 'scripts/description-report.csv'), '﻿' + csv); // BOM so Excel shows macrons
const saved = report.filter((r) => r[1] === 'saved').length;
console.log(`\n${saved} descriptions ${DRY ? 'found (dry run, nothing written)' : 'saved'}. Details in scripts/description-report.csv`);
