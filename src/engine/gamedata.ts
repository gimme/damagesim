// In-memory game data container + name lookups. Loaders: src/node/load.ts (fs) and the web app (bundled JSON).

import type { ChampionData, ChampionIndexEntry, DataMeta, ItemData, RuneData, RunePageData, SpellData } from "./data-types.ts";

export interface GameData {
  meta: DataMeta;
  championIndex: ChampionIndexEntry[];
  champions: Record<string, ChampionData>;
  items: Record<string, ItemData>;
  runes: RuneData[];
  runePage: RunePageData;
  summoners: Record<string, SpellData>;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");

const CHAMPION_ALIASES: Record<string, string> = {
  wukong: "MonkeyKing",
  mf: "MissFortune",
  tf: "TwistedFate",
  j4: "JarvanIV",
  jarvan: "JarvanIV",
  asol: "AurelionSol",
  mundo: "DrMundo",
  nunu: "Nunu",
  kogmaw: "KogMaw",
  ksante: "KSante",
  belveth: "Belveth",
  chogath: "Chogath",
  kaisa: "Kaisa",
  khazix: "Khazix",
  velkoz: "Velkoz",
  reksai: "RekSai",
  renata: "Renata",
  leblanc: "Leblanc",
  fiddle: "Fiddlesticks",
  yi: "MasterYi",
  masteryi: "MasterYi",
};

export function findChampion(data: GameData, query: string): ChampionData {
  const q = norm(query);
  const id =
    data.championIndex.find((c) => norm(c.id) === q || norm(c.name) === q)?.id ??
    CHAMPION_ALIASES[q] ??
    data.championIndex.find((c) => norm(c.name).startsWith(q))?.id;
  const champ = id ? data.champions[id] : undefined;
  if (!champ) throw new Error(`Unknown champion "${query}"`);
  return champ;
}

const ITEM_ALIASES: Record<string, string> = {
  botrk: "Blade of The Ruined King",
  bork: "Blade of The Ruined King",
  ie: "Infinity Edge",
  ldr: "Lord Dominik's Regards",
  rfc: "Rapid Firecannon",
  dcap: "Rabadon's Deathcap",
  rabadon: "Rabadon's Deathcap",
  deathcap: "Rabadon's Deathcap",
  liandry: "Liandry's Torment",
  liandrys: "Liandry's Torment",
  luden: "Luden's Echo",
  ludens: "Luden's Echo",
  nashor: "Nashor's Tooth",
  nashors: "Nashor's Tooth",
  triforce: "Trinity Force",
  tf: "Trinity Force",
  bc: "Black Cleaver",
  ga: "Guardian Angel",
  dd: "Death's Dance",
  pd: "Phantom Dancer",
  rylai: "Rylai's Crystal Scepter",
  rylais: "Rylai's Crystal Scepter",
  zhonya: "Zhonya's Hourglass",
  zhonyas: "Zhonya's Hourglass",
  shojin: "Spear of Shojin",
  sorcs: "Sorcerer's Shoes",
  sorc: "Sorcerer's Shoes",
  berserkers: "Berserker's Greaves",
  zerks: "Berserker's Greaves",
  tabis: "Plated Steelcaps",
  steelcaps: "Plated Steelcaps",
  mercs: "Mercury's Treads",
  lucidity: "Ionian Boots of Lucidity",
  collector: "The Collector",
  youmuu: "Youmuu's Ghostblade",
  youmuus: "Youmuu's Ghostblade",
  seryldas: "Serylda's Grudge",
  serylda: "Serylda's Grudge",
  guinsoo: "Guinsoo's Rageblade",
  guinsoos: "Guinsoo's Rageblade",
  rageblade: "Guinsoo's Rageblade",
  kraken: "Kraken Slayer",
  witsend: "Wit's End",
  rocketbelt: "Hextech Rocketbelt",
  gunblade: "Hextech Gunblade",
  hullbreaker: "Hullbreaker",
  hydra: "Ravenous Hydra",
  titanic: "Titanic Hydra",
  profane: "Profane Hydra",
  shiv: "Statikk Shiv",
  morello: "Morellonomicon",
  archangels: "Archangel's Staff",
  seraphs: "Seraph's Embrace",
  muramana: "Muramana",
  sterak: "Sterak's Gage",
  steraks: "Sterak's Gage",
  eon: "Edge of Night",
  mejai: "Mejai's Soulstealer",
  mejais: "Mejai's Soulstealer",
};

export function findItem(data: GameData, query: number | string): ItemData {
  if (typeof query === "number" || /^\d+$/.test(String(query))) {
    const it = data.items[String(query)];
    if (!it) throw new Error(`Unknown item id ${query}`);
    return it;
  }
  const q = norm(query);
  const alias = ITEM_ALIASES[q];
  const candidates = Object.values(data.items).filter((i) => i.inStore || i.gold.purchasable);
  const exact = (name: string) => candidates.filter((i) => norm(i.name) === norm(name));
  let found = exact(alias ?? query);
  if (!found.length) found = candidates.filter((i) => norm(i.name).startsWith(q));
  if (!found.length) found = candidates.filter((i) => norm(i.name).includes(q));
  if (!found.length) throw new Error(`Unknown item "${query}"`);
  // Prefer the standard (lowest id) store version.
  found.sort((a, b) => Number(b.inStore) - Number(a.inStore) || a.id - b.id);
  return found[0];
}

export function findRune(data: GameData, query: number | string): RuneData {
  if (typeof query === "number" || /^\d+$/.test(String(query))) {
    const r = data.runes.find((x) => x.id === Number(query));
    if (!r) throw new Error(`Unknown rune id ${query}`);
    return r;
  }
  const q = norm(query);
  const r = data.runes.find((x) => norm(x.name) === q || norm(x.key) === q) ?? data.runes.find((x) => norm(x.name).startsWith(q));
  if (!r) throw new Error(`Unknown rune "${query}"`);
  return r;
}
