// Build a self-contained copy of the web UI for hosting where only same-origin files load
// (e.g. a claude.ai Artifact): dist-artifact/{index.html, app.js, icons.json}.
//
//   index.html  page fragment: <title>, inline CSS, root element, <script src="app.js">
//   app.js      the bundled app (React + engine + game data)
//   icons.json  champion/ability/item/rune/summoner icons as data URIs (Data Dragon images are blocked there)
//
// Usage: node scripts/build-artifact.ts

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { loadGameData } from '../src/node/load.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'dist-artifact');
const BUILD = join(OUT, 'build');
const CACHE = join(ROOT, 'data/raw/icons');
mkdirSync(CACHE, { recursive: true });

execFileSync(process.execPath, [join(ROOT, 'scripts/gen-kit-index.ts')], { stdio: 'inherit' });
execFileSync(join(ROOT, 'node_modules/.bin/vite'), ['build'], { stdio: 'inherit', cwd: ROOT, env: { ...process.env, ARTIFACT: '1' } });

const data = loadGameData();
const dd = `https://ddragon.leagueoflegends.com/cdn/${data.meta.ddragonVersion}/img/`;
// [key, url, px]: ability, summoner spell and attack icons only show small (≤22 CSS px).
const wanted: [string, string, number?][] = [];
for (const c of data.championIndex) wanted.push([`champion/${c.id}`, `${dd}${c.icon}`]);
for (const c of Object.values(data.champions)) for (const [slot, path] of Object.entries(c.abilityIcons)) wanted.push([`ability/${c.id}/${slot}`, `https://raw.communitydragon.org/${data.meta.patch}/game/${path}`, 48]);
for (const it of Object.values(data.items)) if ((it.inStore || [3040, 3042, 3121].includes(it.id)) && it.gold.total > 0) wanted.push([`item/${it.id}`, `${dd}item/${it.id}.png`]);
for (const r of data.runes) if (r.icon.startsWith('perk-images')) wanted.push([`rune/${r.icon}`, `https://ddragon.leagueoflegends.com/cdn/img/${r.icon}`]);
for (const key of Object.keys(data.summoners)) wanted.push([`summoner/${key}`, `${dd}spell/${key}.png`, 48]);
wanted.push(['ui/autoattack', `https://raw.communitydragon.org/${data.meta.patch}/game/assets/ux/deathrecap/autoattack.png`, 32]);

const icons: Record<string, string> = {};
let fetched = 0;
await Promise.all(
  Array.from({ length: 12 }, async (_, worker) => {
    for (let i = worker; i < wanted.length; i += 12) {
      const [key, url, px = 64] = wanted[i];
      const file = join(CACHE, key.replace(/[^a-zA-Z0-9.]/g, '_'));
      let buf: Buffer | null = existsSync(file) ? readFileSync(file) : null;
      if (!buf) {
        const res = await fetch(url);
        if (!res.ok) continue;
        buf = Buffer.from(await res.arrayBuffer());
        writeFileSync(file, buf);
        fetched++;
      }
      // 64px WebP keeps icons crisp at the UI's sizes (≤52 CSS px) at a fraction of the size.
      const small = await sharp(buf).resize(px, px, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
      icons[key] = `data:image/webp;base64,${small.toString('base64')}`;
    }
  }),
);
writeFileSync(join(OUT, 'icons.json'), JSON.stringify(icons));

const css = readFileSync(join(BUILD, 'app.css'), 'utf8');
copyFileSync(join(BUILD, 'app.js'), join(OUT, 'app.js'));
const page = `<title>lolsim</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}
</style>
<div id="root"></div>
<script type="module" src="app.js"></script>
`;
writeFileSync(join(OUT, 'index.html'), page);
const mb = (f: string) => (readFileSync(join(OUT, f)).length / 1e6).toFixed(2);
console.log(`dist-artifact: index.html ${mb('index.html')} MB, app.js ${mb('app.js')} MB, icons.json ${mb('icons.json')} MB (${Object.keys(icons).length} icons, ${fetched} downloaded)`);
