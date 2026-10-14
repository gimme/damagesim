// Downloads the League wiki pages lolsim is checked against into data/raw/wiki/pages.json, in
// batches through the MediaWiki API, and only re-downloads pages that changed since the last run.
//
// Groups:
//   abilities       Template:Data <Champion>/<Ability>   each ability's data and description
//   runes           Template:Rune data <Rune>            each rune's data and description
//   items           Module:ItemData/data/<Item>          each item's stats and effects
//   item articles   <Item> (for items in data/generated) notes on interactions (on-hit, abilities…)
//   rune articles   <Rune>                               notes on interactions
//   champion stats  Module:ChampionData/data             base stats of every champion
//   mechanics       Attack effects                       which abilities apply on-hit / on-attack
//
// A run lists every page with its latest revision id (up to 500 per request) and fetches content
// for new or changed pages only (50 per request): a full download is ~80 requests, a refresh ~15.
//
// Usage: node scripts/fetch-wiki.ts [--full]     (--full ignores the cache)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGameData } from '../src/node/load.ts';

const API = 'https://wiki.leagueoflegends.com/en-us/api.php';
// The wiki's bot protection challenges browser-like user agents from non-browser clients; the
// MediaWiki API asks clients to identify themselves anyway.
const UA = 'lolsim-wiki-audit/0.1 (League damage simulator; MediaWiki API client)';
const DIR = join(import.meta.dirname, '..', 'data', 'raw', 'wiki');
export const WIKI_CACHE = join(DIR, 'pages.json');

interface Cache {
  fetchedAt: string;
  pages: Record<string, { group: string; revid: number; content: string }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let requests = 0;

async function api(params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', ...params });
  for (let attempt = 1; ; attempt++) {
    await sleep(1000);
    requests++;
    // POST keeps long title lists out of the URL.
    const res = await fetch(API, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const text = await res.text();
    if (res.ok && text.startsWith('{')) return JSON.parse(text);
    if (attempt >= 4) throw new Error(`wiki API: HTTP ${res.status} ${text.slice(0, 120)}`);
    process.stderr.write(`  HTTP ${res.status}${res.headers.get('cf-mitigated') ? ' (challenge)' : ''}, retrying in 20s…\n`);
    await sleep(20000);
  }
}

/** Every page with a title prefix in a namespace, with its latest revision id. */
async function listPrefix(namespace: number, prefix: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let cont: Record<string, string> = {};
  for (;;) {
    const j = await api({ generator: 'allpages', gapnamespace: String(namespace), gapprefix: prefix, gaplimit: '500', prop: 'info', ...cont });
    for (const p of j.query?.pages ?? []) out.set(p.title, p.lastrevid);
    if (!j.continue) return out;
    cont = j.continue;
  }
}

/** Latest revision ids of exact titles (missing pages are left out). */
async function listTitles(titles: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < titles.length; i += 50) {
    const j = await api({ prop: 'info', titles: titles.slice(i, i + 50).join('|'), redirects: '1' });
    for (const p of j.query?.pages ?? []) if (!p.missing && !p.invalid && p.lastrevid) out.set(p.title, p.lastrevid);
  }
  return out;
}

async function fetchContent(titles: string[]): Promise<Map<string, { revid: number; content: string }>> {
  const out = new Map<string, { revid: number; content: string }>();
  for (let i = 0; i < titles.length; i += 50) {
    const j = await api({ prop: 'revisions', rvprop: 'ids|content', rvslots: 'main', titles: titles.slice(i, i + 50).join('|') });
    for (const p of j.query?.pages ?? []) {
      const rev = p.revisions?.[0];
      if (rev) out.set(p.title, { revid: rev.revid, content: rev.slots?.main?.content ?? '' });
    }
    process.stderr.write(`  ${Math.min(i + 50, titles.length)}/${titles.length} pages\n`);
  }
  return out;
}

async function main() {
  const full = process.argv.includes('--full');
  const cache: Cache = !full && existsSync(WIKI_CACHE) ? JSON.parse(readFileSync(WIKI_CACHE, 'utf8')) : { fetchedAt: '', pages: {} };
  const data = loadGameData();

  // Listing (titles + revision ids), group by group.
  const groups: [string, Map<string, number>][] = [];
  const abilities = await listPrefix(10, 'Data_');
  // Sub-pages only; the one-letter ones (…/Q, …/I) just point at the ability pages.
  groups.push(['abilities', new Map([...abilities].filter(([t]) => t.includes('/') && !/\/[QWERI]$/.test(t)))]);
  groups.push(['runes', await listPrefix(10, 'Rune_data_')]);
  groups.push(['items', await listPrefix(828, 'ItemData/data/')]);
  // Article titles from our data; names with markup (Arena items) aren't titles, and stat shards
  // (ids 5000-5999) only redirect to generic stat pages.
  const itemNames = [...new Set(Object.values(data.items).map((i) => i.name))].filter((n) => !/[<>]/.test(n));
  groups.push(['item articles', await listTitles(itemNames)]);
  groups.push(['rune articles', await listTitles([...new Set(data.runes.filter((r) => r.id < 5000 || r.id >= 6000).map((r) => r.name))])]);
  groups.push(['champion stats', await listTitles(['Module:ChampionData/data'])]);
  groups.push(['mechanics', await listTitles(['Attack effects'])]);

  const wanted = new Map<string, { group: string; revid: number }>();
  for (const [group, pages] of groups) for (const [title, revid] of pages) if (!wanted.has(title)) wanted.set(title, { group, revid });
  const stale = [...wanted].filter(([title, w]) => cache.pages[title]?.revid !== w.revid).map(([t]) => t);
  const removed = Object.keys(cache.pages).filter((t) => !wanted.has(t));
  const listing = requests;
  console.log(`${wanted.size} pages listed in ${listing} requests: ${stale.length} new or changed, ${removed.length} gone`);

  const fresh = await fetchContent(stale);
  for (const t of removed) delete cache.pages[t];
  for (const [title, page] of fresh) cache.pages[title] = { group: wanted.get(title)?.group ?? 'other', ...page };
  cache.fetchedAt = new Date().toISOString();
  mkdirSync(DIR, { recursive: true });
  writeFileSync(WIKI_CACHE, JSON.stringify(cache));

  const counts: Record<string, number> = {};
  for (const p of Object.values(cache.pages)) counts[p.group] = (counts[p.group] ?? 0) + 1;
  console.log(`cached ${Object.keys(cache.pages).length} pages (${Object.entries(counts).map(([g, n]) => `${n} ${g}`).join(', ')}) in ${requests} requests -> ${WIKI_CACHE}`);
  const missingItems = itemNames.filter((n) => !groups.find(([g]) => g === 'item articles')![1].has(n));
  if (missingItems.length) console.log(`no wiki article for ${missingItems.length} item names (e.g. ${missingItems.slice(0, 5).join(', ')})`);
}

if (import.meta.main) await main();
