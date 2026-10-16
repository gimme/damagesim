// Bundles the generated game data for the browser.

import type { GameData } from '../engine/gamedata.ts';
import type { ChampionData } from '../engine/data-types.ts';
import meta from '@data/meta.json';
import championIndex from '@data/champions.json';
import items from '@data/items.json';
import runes from '@data/runes.json';
import runePage from '@data/rune-page.json';
import summoners from '@data/summoners.json';

const champFiles = import.meta.glob('@data/champions/*.json', { eager: true, import: 'default' }) as Record<string, ChampionData>;

const champions: Record<string, ChampionData> = {};
for (const c of Object.values(champFiles)) champions[c.id] = c;

export const DATA: GameData = {
  meta: meta as GameData['meta'],
  championIndex: championIndex as GameData['championIndex'],
  champions,
  items: items as unknown as GameData['items'],
  runes: runes as unknown as GameData['runes'],
  runePage,
  summoners: summoners as unknown as GameData['summoners'],
};

const DD = `https://ddragon.leagueoflegends.com/cdn/${(meta as any).ddragonVersion}/img/`;

// The hosted build can't load images from Data Dragon, so it ships them as data URIs in icons.json.
let BUNDLED: Record<string, string> | null = null;
export async function loadBundledIcons(): Promise<boolean> {
  if (typeof __ARTIFACT__ === 'undefined' || !__ARTIFACT__) return false;
  try {
    const res = await fetch('icons.json');
    if (res.ok) BUNDLED = await res.json();
  } catch {
    BUNDLED = null;
  }
  return !!BUNDLED;
}
const bundledOr = (key: string, url: string) => (BUNDLED ? (BUNDLED[key] ?? '') : url);

export const championIcon = (id: string) => bundledOr(`champion/${id}`, `${DD}champion/${DATA.champions[id]?.icon.replace(/^champion\//, '') ?? id + '.png'}`);
export const itemIcon = (id: number) => bundledOr(`item/${id}`, `${DD}item/${id}.png`);
// Trees and runes are on Data Dragon; stat shards only in the game files.
export const runeIcon = (icon: string) =>
  icon.startsWith('perk-images') ? bundledOr(`rune/${icon}`, `https://ddragon.leagueoflegends.com/cdn/img/${icon}`) : icon.startsWith('assets/') ? bundledOr(`rune/${icon}`, `https://raw.communitydragon.org/${DATA.meta.patch}/game/${icon}`) : '';
export const abilityIcon = (champion: string, slot: 'P' | 'Q' | 'W' | 'E' | 'R') => {
  const path = DATA.champions[champion]?.abilityIcons[slot];
  return path ? bundledOr(`ability/${champion}/${slot}`, `https://raw.communitydragon.org/${DATA.meta.patch}/game/${path}`) : '';
};
export const summonerIcon = (key: string) => bundledOr(`summoner/${key}`, `${DD}spell/${key}.png`);
// The Death Recap's icon for basic attacks.
export const autoAttackIcon = () => bundledOr('ui/autoattack', `https://raw.communitydragon.org/${DATA.meta.patch}/game/assets/ux/deathrecap/autoattack.png`);
