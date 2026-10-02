import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const prerender = JSON.parse(fs.readFileSync('.next/prerender-manifest.json', 'utf8'));
if (!prerender.routes['/quiz-offline'] || prerender.routes['/quiz-offline'].initialStatus && prerender.routes['/quiz-offline'].initialStatus !== 200) throw Error('quiz-offline must be a public static page');
const html = fs.readFileSync('.next/server/app/quiz-offline.html', 'utf8');
const assets = new Map();
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function add(raw) {
  const url = new URL(raw.replaceAll('&amp;', '&'), 'https://local.invalid');
  if (url.origin !== 'https://local.invalid' || !/^\/_next\/static\/[a-zA-Z0-9_./%()\[\]-]+\.(?:js|css|woff2)$/.test(url.pathname)) throw Error('unexpected offline asset');
  const key = url.pathname + url.search;
  if (assets.has(key)) return;
  const file = path.resolve(root, '.next', decodeURIComponent(url.pathname.slice('/_next/'.length)));
  if (!file.startsWith(path.join(root, '.next', 'static') + path.sep)) throw Error('offline asset escaped build');
  const bytes = fs.readFileSync(file); assets.set(key, digest(bytes));
  if (url.pathname.endsWith('.css')) for (const match of bytes.toString().matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) {
    if (match[1].startsWith('data:')) continue;
    add(new URL(match[1], url).pathname);
  }
}
for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
  if (tag[0].startsWith('<link') && !/\brel="(?:stylesheet|preload|modulepreload)"/.test(tag[0])) continue;
  const value = /\b(?:src|href)="([^"]+)"/.exec(tag[0]);
  if (value) add(value[1]);
}
if (![...assets.keys()].some(k => k.includes('quiz-offline') && k.includes('.js')) || assets.size < 3) throw Error('offline page assets missing');
const template = fs.readFileSync('scripts/quiz-offline-worker.template.js', 'utf8');
const manifest = { build: digest(html), html: digest(html), assets: Object.fromEntries(assets) };
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/quiz-offline-sw.js', template.replace('/* OFFLINE_MANIFEST */ null', JSON.stringify(manifest)));
console.log(`Offline quiz: ${assets.size} verified public assets, ${manifest.build.slice(0, 12)}`);
