// Finds a logo for each nonprofit that has a website, saves it to
// src/assets/logos/, and adds a `logo:` line to its Markdown file.
//
//   node scripts/fetch-logos.mjs            # do it
//   node scripts/fetch-logos.mjs --dry-run  # just report what it would do
//   node scripts/fetch-logos.mjs --force    # also replace logos already set
//
// Writes scripts/logo-report.csv so you can review every result.
// Facebook pages are skipped (they hide behind a login wall).

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CONTENT = path.join(ROOT, 'src/content/nonprofits');
const LOGOS = path.join(ROOT, 'src/assets/logos');
const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const CONCURRENCY = 6;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif', 'image/avif': 'avif' };

async function get(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];

// Collect candidate image URLs from the page, best first.
function candidates(html, base) {
  const out = [];
  const add = (src, kind, score) => {
    if (!src || src.startsWith('data:')) return;
    try { out.push({ url: new URL(src.trim(), base).href, kind, score }); } catch {}
  };

  // 1. <img> tags that look like a logo (in header/nav if possible)
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const hay = [attr(tag, 'src'), attr(tag, 'class'), attr(tag, 'id'), attr(tag, 'alt')].join(' ').toLowerCase();
    if (/logo/.test(hay) && !/(partner|sponsor|funder|footer)/.test(hay)) {
      const src = attr(tag, 'src') || attr(tag, 'data-src') || attr(tag, 'data-lazy-src');
      add(src, 'img-logo', src?.toLowerCase().endsWith('.svg') ? 100 : 90);
    }
  }
  // 2. Icon links
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase();
    const href = attr(tag, 'href');
    const size = parseInt((attr(tag, 'sizes') ?? '').split('x')[0], 10) || 0;
    if (rel.includes('apple-touch-icon')) add(href, 'apple-touch-icon', 80);
    else if (rel.includes('icon') && !href?.toLowerCase().endsWith('.ico')) add(href, 'icon', size >= 96 ? 70 : 40);
  }
  return out.sort((a, b) => b.score - a.score);
}

// Download a candidate; returns { buf, ext } or null if it isn't a usable image.
async function download(url) {
  try {
    const res = await get(url);
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    const buf = Buffer.from(await res.arrayBuffer());
    let ext = EXT[type];
    if (!ext && /^\s*(<\?xml|<svg)/.test(buf.subarray(0, 200).toString())) ext = 'svg';
    if (!ext || buf.length < 200) return null; // too small to be a real logo
    return { buf, ext };
  } catch {
    return null;
  }
}

async function findLogo(site) {
  const res = await get(site);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  for (const c of candidates(html, res.url)) {
    const img = await download(c.url);
    if (img) return { ...img, source: c.kind, from: c.url };
  }
  // Last resort: Google's favicon service (PNG, up to 128px, can be blurry)
  const host = new URL(res.url).hostname;
  const img = await download(`https://www.google.com/s2/favicons?domain=${host}&sz=128`);
  if (img) return { ...img, source: 'google-favicon', from: host };
  return null;
}

const files = (await fs.readdir(CONTENT)).filter((f) => f.endsWith('.md'));
const report = [['file', 'result', 'source', 'logo file', 'from']];
await fs.mkdir(LOGOS, { recursive: true });

let i = 0;
async function worker() {
  while (i < files.length) {
    const file = files[i++];
    const p = path.join(CONTENT, file);
    const md = await fs.readFile(p, 'utf8');
    const slug = file.replace(/\.md$/, '');
    const site = md.match(/^website:\s*"?([^"\r\n]+)"?/m)?.[1];
    const row = (result, source = '', logo = '', from = '') => report.push([file, result, source, logo, from]);

    if (/^logo:/m.test(md) && !FORCE) { row('skipped: logo already set'); continue; }
    if (!site) { row('skipped: no website'); continue; }
    if (/facebook\.com/i.test(site)) { row('skipped: facebook page'); continue; }

    try {
      const logo = await findLogo(site);
      if (!logo) { row('no logo found', '', '', site); continue; }
      const name = `${slug}.${logo.ext}`;
      if (!DRY) {
        await fs.writeFile(path.join(LOGOS, name), logo.buf);
        const line = `logo: ../../assets/logos/${name}`;
        const updated = /^logo:.*$/m.test(md)
          ? md.replace(/^logo:.*$/m, line)
          : md.replace(/^(name:.*)$/m, `$1\n${line}`);
        await fs.writeFile(p, updated);
      }
      row('saved', logo.source, name, logo.from);
      console.log(`✓ ${slug}  (${logo.source})`);
    } catch (e) {
      row(`error: ${e.name === 'AbortError' ? 'timed out' : e.message}`, '', '', site);
      console.log(`✗ ${slug}  ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const csv = report.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
await fs.writeFile(path.join(ROOT, 'scripts/logo-report.csv'), csv);
const saved = report.filter((r) => r[1] === 'saved').length;
console.log(`\n${saved} logos ${DRY ? 'found (dry run, nothing written)' : 'saved'}. Details in scripts/logo-report.csv`);
