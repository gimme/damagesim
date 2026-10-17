// Damage mitigation: resistances, reduction, penetration.

export type DamageType = "physical" | "magic" | "true";

/** Damage multiplier for a given (effective) resistance value. */
export function resistMultiplier(resist: number): number {
  return resist >= 0 ? 100 / (100 + resist) : 2 - 100 / (100 - resist);
}

export interface ResistInput {
  base: number;
  bonus: number;
}

export interface Reduction {
  /** Flat resist reduction (applied first; can take resist below zero). */
  flat: number;
  /** Percent resist reduction, fraction (applied second; only while resist > 0). */
  percent: number;
}

export interface Penetration {
  /** Percent penetration (fraction). */
  percent: number;
  /** Percent penetration on bonus resist only (fraction). */
  bonusPercent: number;
  /** Flat penetration incl. lethality (cannot reduce below 0). */
  flat: number;
}

/**
 * Effective resistance after reductions and penetration, in the game's order:
 * flat reduction → % reduction → % penetration (and bonus % pen) → flat penetration.
 * Flat reduction is split between base and bonus proportionally. Penetration never brings
 * resist below zero, and none of the percentage effects apply when resist is already ≤ 0.
 */
export function effectiveResist(r: ResistInput, red: Reduction, pen: Penetration): number {
  let base = r.base;
  let bonus = r.bonus;
  const total = base + bonus;

  if (red.flat) {
    if (total > 0) {
      const share = base / total;
      base -= red.flat * share;
      bonus -= red.flat * (1 - share);
    } else {
      base -= red.flat;
    }
  }
  if (red.percent && base + bonus > 0) {
    if (base > 0) base *= 1 - red.percent;
    if (bonus > 0) bonus *= 1 - red.percent;
  }
  let res = base + bonus;
  if (res <= 0) return res;

  if (pen.percent || pen.bonusPercent) {
    const b = Math.max(0, base) * (1 - pen.percent);
    const bb = Math.max(0, bonus) * (1 - pen.percent) * (1 - pen.bonusPercent);
    res = b + bb + Math.min(0, base) + Math.min(0, bonus);
  }
  if (pen.flat) res = Math.max(0, res - pen.flat);
  return res;
}
