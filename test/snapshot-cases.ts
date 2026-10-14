// Standard scenarios recorded per champion by scripts/update-snapshots.ts.

import type { Scenario } from '../src/engine/sim.ts';

export const SNAPSHOT_CASES: Record<string, Omit<Scenario, 'champion'>> = {
  'L11 no items QWER AA': { level: 11, combo: 'Q W E R AA AA', target: { maxHp: 2200, armor: 80, mr: 55 } },
  'L16 AP build + Electrocute': {
    level: 16,
    items: ["Luden's Echo", "Sorcerer's Shoes", "Rabadon's Deathcap", 'Void Staff'],
    runes: ['Electrocute', 'Cheap Shot', 5008, 5008, 5001],
    combo: 'Q W E R AA',
    target: { maxHp: 2800, armor: 110, mr: 75, bonusHp: 900 },
  },
  'L16 AD build + Conqueror': {
    level: 16,
    items: ['Trinity Force', "Sterak's Gage", 'Black Cleaver', "Berserker's Greaves"],
    runes: ['Conqueror', 'Last Stand', 5005, 5008, 5001],
    combo: 'Q AA W AA E AA R AA',
    target: { maxHp: 2800, armor: 110, mr: 75, bonusHp: 900 },
  },
};
