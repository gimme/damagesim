// Downloads raw game data for one patch into data/raw/<patch>/.
//
// Sources:
//   - CommunityDragon (raw.communitydragon.org): the game's own .bin files converted to JSON.
//     These hold the exact per-rank values and tooltip formulas used by the client.
//   - Data Dragon (ddragon.leagueoflegends.com): names, icons, item map availability, rune trees.
//
// Usage: node scripts/fetch-data.ts [patch]     e.g. 16.20  (default: latest live patch)

import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

async function getJson(url: string): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 4) throw new Error(`GET ${url} failed: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function save(path: string, url: string, force = false) {
  if (!force && (await exists(path))) return;
  const json = await getJson(url);
  await writeFile(path, JSON.stringify(json));
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

async function main() {
  const versions: string[] = await getJson("https://ddragon.leagueoflegends.com/api/versions.json");
  const requested = process.argv[2];
  const ddVersion = requested ? versions.find((v) => v.startsWith(requested + ".")) : versions[0];
  if (!ddVersion) throw new Error(`Unknown patch ${requested}`);
  const patch = ddVersion.split(".").slice(0, 2).join(".");

  // CommunityDragon keeps a folder per patch; "latest" is used only when the patch folder is missing.
  let cdBase = `https://raw.communitydragon.org/${patch}`;
  try {
    await getJson(`${cdBase}/content-metadata.json`);
  } catch {
    cdBase = "https://raw.communitydragon.org/latest";
  }
  const meta = await getJson(`${cdBase}/content-metadata.json`);

  const dir = join(ROOT, "data/raw", patch);
  await mkdir(join(dir, "champions"), { recursive: true });
  console.log(`patch ${patch} (ddragon ${ddVersion}, cdragon ${meta.version}) -> ${dir}`);

  const dd = `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/data/en_US`;
  await save(join(dir, "dd_champion.json"), `${dd}/champion.json`);
  await save(join(dir, "dd_item.json"), `${dd}/item.json`);
  await save(join(dir, "dd_runes.json"), `${dd}/runesReforged.json`);
  await save(join(dir, "items.bin.json"), `${cdBase}/game/items.cdtb.bin.json`);
  await save(join(dir, "perks.bin.json"), `${cdBase}/game/perks.cdtb.bin.json`);
  await save(join(dir, "shared.bin.json"), `${cdBase}/game/shared.cdtb.bin.json`);
  await save(join(dir, "stringtable.json"), `${cdBase}/game/en_us/data/menu/en_us/lol.stringtable.json`);
  await writeFile(
    join(dir, "meta.json"),
    JSON.stringify({ patch, ddragonVersion: ddVersion, cdragonVersion: meta.version, cdragonBase: cdBase, fetchedAt: new Date().toISOString() }, null, 2),
  );

  const champs = Object.values((await getJson(`${dd}/champion.json`)).data) as any[];
  let done = 0;
  await pool(champs, 12, async (c) => {
    const alias = c.id.toLowerCase();
    await save(join(dir, "champions", `${alias}.bin.json`), `${cdBase}/game/data/characters/${alias}/${alias}.bin.json`);
    if (++done % 25 === 0) console.log(`  champions ${done}/${champs.length}`);
  });
  console.log(`done: ${champs.length} champions`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
