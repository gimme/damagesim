// Compare champion kits with the League wiki: which abilities apply on-hit effects and trigger
// on-attack effects (Spellblade, Energized, Guinsoo's, Lethal Tempo…), at what effectiveness, and
// which can critically strike; and whether each ability's damage is proc damage, spell damage or
// neither (the template's "spell effects" field), checked on the damage a simulated combo deals.
//
// Sources (data/raw/wiki/pages.json, downloaded by scripts/fetch-wiki.ts):
//   * each ability's data template ("Template:Data <Champion>/<Ability>"), whose description says
//     e.g. "applies on-hit effects … and triggers on-attack effects";
//   * the "Attack effects" page lists "Applying on-hit effects" and "Triggering on-attack effects".
//
// Usage: node scripts/audit-wiki.ts [Champion ...] [--all]     (run scripts/fetch-wiki.ts first)
//   --all     also print abilities that match

import { existsSync, readFileSync } from 'node:fs';
import { loadGameData } from '../src/node/load.ts';
import { loadAllKits } from '../src/node/kits.ts';
import { getKit } from '../src/kits/index.ts';
import { simulate } from '../src/engine/sim.ts';
import type { ChampionData } from '../src/engine/data-types.ts';
import type { ComponentSpec } from '../src/engine/kit-types.ts';
import type { DamageInstance } from '../src/engine/effects.ts';

import { WIKI_CACHE } from './fetch-wiki.ts';

const args = process.argv.slice(2);
const showAll = args.includes('--all');

/** Differences checked by hand: the kit models the effect another way. Key: "<champion id> <slot>". */
const REVIEWED: Record<string, string> = {
  'Akshan P': 'second shot is a basic attack fired by a hook',
  'Lucian P': 'second shot is a basic attack fired by a hook',
  'MasterYi P': 'Double Strike is a basic attack fired by a hook',
  'Rengar P': 'the leap is the basic attack',
  'Nocturne P': 'Umbra Blades modifies the basic attack in a hook (crit at the 110% ratio)',
  'Pantheon W': 'empowered W is a Mortal Will buff (empowered attack) applied by a hook',
  'Braum P': 'a basic-attack on-hit effect (stacks), not an ability that applies on-hit',
  'Blitzcrank R': 'the passive is a basic-attack on-hit effect (mark), modeled in a hook',
  'Jax R': 'Grandmaster-at-Arms is a mark consumed by basic attacks',
  'Kennen W': 'every-5th-attack passive; crit via the game formula TotalDamagePassiveCrit',
  'Aphelios R': 'crit via the game formula CritDamageModCalc',
  'Gangplank E': 'barrel damage is Q:barrel (canCrit)',
  'Yunara Q': 'spread attacks only hit other enemies',
  'Viego Q': 'on-hit/crit refer to the passive and the second strike (a basic attack fired by a hook); the stab scales with crit chance in its formula',
  'Twitch R': 'the bolts are his basic attacks (R is a buff)',
  'Zeri R': 'the crit applies to the chain lightning, which only hits other enemies',
};

/** Damage category differences checked by hand. Key: "<champion id> <damage label>". */
const REVIEWED_TAGS: Record<string, string> = {
  'Diana Moonsilver Blade': 'part of her attack, which works like a regular one',
  'Ornn Brittle': "Living Forge's damage (Temper), tagged proc",
  'Vex Gloom': "Doom 'n Gloom's damage, tagged proc",
};

type Category = 'proc' | 'spell' | 'default';

/** The template's "spell effects" field as a damage category; null when it depends on the part. */
function category(spellEffects: string): Category | null {
  const s = spellEffects.replace(/<!--[\s\S]*?-->/g, '').trim().toLowerCase();
  if (s === 'proc') return 'proc';
  if (s === 'default') return 'default';
  return /^(spell|spellaoe|spellpersist|aoe|aoedot|dot|area|area of effect|damage over time|single|single target|single-target)$/.test(s) ? 'spell' : null;
}

/** How the simulator tags a hit: proc damage, ability damage (spell effects) or neither. */
const kitCategory = (inst: DamageInstance): Category => (inst.flags.proc ? 'proc' : inst.flags.ability ? 'spell' : 'default');

/** Strip common wiki templates down to their visible text. */
function plain(s: string): string {
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(/\{\{(?:tip|sti|tt|as|ai|cai|ii|ri|fd|g|sbc|ap|pp|rd|st)\|([^|{}]*)(?:\|[^{}]*)?\}\}/g, '$1');
  }
  return s.replace(/'''|''/g, '');
}

interface WikiAbility {
  name: string;
  slot: 'P' | 'Q' | 'W' | 'E' | 'R';
  spellEffects: string;
  onHit: boolean;
  onAttack: boolean;
  effectiveness: string[];
  canCrit: boolean;
}

function parseTemplate(raw: string, fallbackName: string): WikiAbility | null {
  const slot = raw.match(/^\|skill\s*=\s*([QWERI])\b/m)?.[1];
  if (!slot) return null;
  const name = raw.match(/\}\}\}\}\}\|([^|]+)\|/)?.[1]?.trim() ?? fallbackName;
  // Descriptions and blurbs only (not notes or patch history).
  const text = plain([...raw.matchAll(/^\|(?:description\d*|blurb\d*)\s*=([\s\S]*?)(?=^\|[a-z ]+\d*\s*=)/gm)].map((m) => m[1]).join('\n'));
  const negHit = /(?:does not|doesn't|cannot|can't) apply on-hit/i.test(text);
  // Negative mentions (often about secondary targets) don't count: "…nor trigger on-attack effects".
  const negAtk = /(?:does not|doesn't|cannot|can't|nor) trigger on-attack/i.test(text);
  return {
    name,
    slot: slot === 'I' ? 'P' : (slot as WikiAbility['slot']),
    spellEffects: raw.match(/^\|spelleffects\s*=\s*(.*)$/m)?.[1] ?? '',
    onHit: !negHit && /appl(?:y|ies|ying)\b[^.]{0,80}\bon-hit\b(?! damage)|\band on-hit (?:and on-attack )?effects/i.test(text),
    onAttack: !negAtk && /trigger(?:s|ing)?\b[^.]{0,60}\bon-attack\b|\band on-attack effects/i.test(text),
    effectiveness: [...text.matchAll(/(\d+(?:\.\d+)?%)[^.]{0,40}?effectiveness/gi)].map((m) => m[1]),
    canCrit: !/(?:cannot|can't|does not|doesn't) critically strike/i.test(text) && /\bcan critically strike|\bcritically strikes? (?:for|if|when)|\bcan crit\b/i.test(text),
  };
}

if (!existsSync(WIKI_CACHE)) {
  console.error('No wiki cache: run node scripts/fetch-wiki.ts first.');
  process.exit(1);
}
const pages: Record<string, { content: string }> = JSON.parse(readFileSync(WIKI_CACHE, 'utf8')).pages;

/** Ability names listed on the "Attack effects" page: [champion, ability][] per section. */
function attackEffectsLists(): { onHit: [string, string][]; onAttack: [string, string][] } {
  const raw = pages['Attack effects']?.content ?? '';
  const section = (title: string) => {
    const start = raw.indexOf(`== ${title} ==`);
    if (start < 0) return [];
    const rest = raw.slice(start + title.length + 6);
    const end = rest.search(/\n==[^=]/);
    const body = (end < 0 ? rest : rest.slice(0, end)).split('=== Items ===')[0];
    // {{cai|Ability|Champion}} starts an entry; "and {{ai|Other|Champion}}" adds abilities to it.
    const out: [string, string][] = [];
    for (const line of body.split('\n')) {
      for (const m of line.matchAll(/\{\{c?ai\|([^|}]+)\|([^|}]+)(?:\|[^}]*)?\}\}/gi)) out.push([m[2].trim(), m[1].trim()]);
    }
    return out;
  };
  return { onHit: section('Applying on-hit effects'), onAttack: section('Triggering on-attack effects') };
}

const data = loadGameData();
await loadAllKits();
const lists = attackEffectsLists();
// Ability templates by champion name: "Template:Data <Champion>/<Ability>".
const templates = new Map<string, { title: string; content: string }[]>();
for (const [title, page] of Object.entries(pages)) {
  const m = title.match(/^Template:Data ([^/]+)\/(.+)$/);
  if (!m) continue;
  if (!templates.has(m[1])) templates.set(m[1], []);
  templates.get(m[1])!.push({ title: m[2], content: page.content });
}
const wanted = args.filter((a) => !a.startsWith('--')).map((a) => a.toLowerCase());
const champs = (Object.values(data.champions) as ChampionData[]).filter((c) => !wanted.length || wanted.includes(c.id.toLowerCase()) || wanted.includes(c.name.toLowerCase()));

let mismatches = 0;
for (const champ of champs) {
  const own = templates.get(champ.name);
  if (!own) {
    console.log(`${champ.name}: no ability templates in the wiki cache`);
    continue;
  }
  const abilities = own.map((t) => parseTemplate(t.content, t.title)).filter((a): a is WikiAbility => !!a);
  // Merge in the Attack effects lists (by ability name).
  const listed = (l: [string, string][], ab: WikiAbility) => l.some(([c, a]) => (c === champ.name || c === champ.id) && (a === ab.name || a === ab.slot));
  const kit = getKit(champ);
  // Current ability names (templates of reworked abilities stay on the wiki).
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const current = new Set([champ.passive.name, ...champ.abilities.flatMap((a) => a.spells.map((sp) => sp.name))].flatMap((n) => n.split(' / ')).map(norm));
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const ab of abilities) {
    if (seen.has(`${ab.slot}:${ab.name}`)) continue;
    seen.add(`${ab.slot}:${ab.name}`);
    if (!current.has(norm(ab.name.replace(/ \d$/, '')))) continue;
    const reviewed = REVIEWED[`${champ.id} ${ab.slot}`];
    const onHit = ab.onHit || listed(lists.onHit, ab);
    const onAttack = ab.onAttack || listed(lists.onAttack, ab);
    const spec = kit.abilities[ab.slot] ?? {};
    const variants = Object.values(spec.variants ?? {});
    const comps: ComponentSpec[] = [...(spec.components ?? []), ...variants.flatMap((v) => v.components ?? [])];
    const buffs = [spec.buff ?? [], ...variants.map((v) => v.buff ?? [])].flat();
    const empowered = buffs.some((b) => b.empowerAttacks) || (ab.slot === 'P' && !!kit.attack);
    const buffComps = buffs.flatMap((b) => [...(b.empowerAttacks?.components ?? []), ...(b.onHit ?? [])]);
    const ours = {
      onHit: comps.some((c) => c.onHit || c.attack),
      onAttack: comps.some((c) => c.onAttack),
      eff: comps.filter((c) => c.onHitEffectiveness !== undefined).map((c) => String(c.onHitEffectiveness)),
      canCrit: [...comps, ...buffComps].some((c) => c.canCrit || (c.attack && c.canCrit !== false)),
    };
    if (onHit || onAttack) {
      const ok = (!onHit || ours.onHit || empowered) && (!onAttack || ours.onAttack || empowered);
      if (!ok && !reviewed) mismatches++;
      if ((!ok && !reviewed) || showAll) {
        const w = [onHit && 'on-hit', onAttack && 'on-attack', ab.effectiveness.length && `${ab.effectiveness.join('/')} effectiveness`].filter(Boolean).join(', ');
        const k = [ours.onHit && 'onHit', ours.onAttack && 'onAttack', empowered && 'empowered attack', ours.eff.length && `effectiveness ${ours.eff.join('/')}`].filter(Boolean).join(', ') || 'plain ability damage';
        lines.push(`  ${ok ? 'ok      ' : reviewed ? 'reviewed' : 'MISMATCH'} ${ab.slot} ${ab.name}: wiki ${w} | kit ${k}${!ok && reviewed ? ` (${reviewed})` : ''}`);
      }
    }
    if (ab.canCrit && !ours.canCrit && !empowered && (!reviewed || showAll)) {
      if (!reviewed) mismatches++;
      lines.push(`  ${reviewed ? 'reviewed' : 'CRIT?   '} ${ab.slot} ${ab.name}: wiki says it can critically strike | kit has no canCrit component${reviewed ? ` (${reviewed})` : ''}`);
    }
  }
  // Damage categories: each ability hit of a few combos (full health and low health targets) against
  // the wiki ability it is named after (its label, the label's parts, its source), else its slot's.
  const live = abilities.filter((ab, i) => current.has(norm(ab.name.replace(/ \d$/, ''))) && abilities.findIndex((x) => x.name === ab.name) === i);
  const combos = ['Q AA W AA E AA R AA AA AA AA'];
  if (kit.abilities.P?.components?.length) combos.push('P AA');
  for (const [slot, spec] of Object.entries(kit.abilities)) for (const v of Object.keys(spec?.variants ?? {})) combos.push(`${slot}:${v} AA AA`);
  const reported = new Set<string>();
  for (const combo of combos) {
    for (const hpPercent of [100, 25]) {
      let events: DamageInstance[];
      try {
        events = simulate(data, { champion: champ.id, level: 18, combo, target: { maxHp: 3000, armor: 80, mr: 60, hpPercent } }).events;
      } catch {
        continue;
      }
      for (const e of events) {
        if (e.flags.kind !== 'ability' || e.flags.attack || e.flags.pet || !e.flags.slot) continue;
        // "Achooo! (Dragon Practice)" is Dragon Practice's, "Upheaval (throw)" Upheaval's.
        const names = [e.label, ...e.sourceLabel.split(' / ')].flatMap((n) => {
          const m = n.match(/^(.*) \((.*)\)$/);
          return m ? [n, m[2], m[1]] : [n];
        });
        const wiki = names.map((n) => live.filter((ab) => norm(ab.name) === norm(n))).find((l) => l.length) ?? live.filter((ab) => ab.slot === e.flags.slot);
        const cats = new Set(wiki.map((ab) => category(ab.spellEffects)));
        const want = cats.size === 1 ? [...cats][0] : null;
        const got = kitCategory(e);
        if (!want || got === want || reported.has(`${e.label} ${got}`)) continue;
        reported.add(`${e.label} ${got}`);
        const reviewed = REVIEWED_TAGS[`${champ.id} ${e.label}`];
        if (!reviewed) mismatches++;
        if (!reviewed || showAll)
          lines.push(`  ${reviewed ? 'reviewed' : 'TAGS    '} ${e.flags.slot} ${e.sourceLabel} / ${e.label}: wiki ${want} (${wiki.map((ab) => `${ab.name}: ${ab.spellEffects}`).join(', ')}) | kit ${got}${reviewed ? ` (${reviewed})` : ''}`);
      }
    }
  }
  if (lines.length) console.log(`${champ.name}\n${lines.join('\n')}`);
}
console.log(`\n${champs.length} champions, ${mismatches} mismatches. Hook-driven attacks (performAttackHit in hooks) count as basic attacks; review mismatches by hand.`);
