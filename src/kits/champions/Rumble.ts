import type { ChampionKit, DebuffSpec } from '../../engine/kit-types.ts';

// Rumble — patch 16.20.
// Heat is not tracked: Danger Zone casts are the ":dz" variants, and "P" starts Overheat.

// Electro Harpoon MR shred; a harpoon hitting a target already slowed by it applies the enhanced shred.
const harpoonShred = (mult: string): DebuffSpec => ({
  id: 'rumbleE',
  label: 'Electro Harpoon shred',
  duration: 'dv.ShredDuration',
  mrReduction: `(debuff.rumbleE ? dv.EnhancedMagicPen : dv.PercMagicPen) * ${mult}`,
});

const kit: ChampionKit = {
  id: 'Rumble',
  status: 'curated',
  notes: [
    'Heat is not tracked: use Q:dz / E:dz for Danger Zone casts (×1.5), and "P" to start Overheat (attack speed + on-hit magic damage for 4s).',
    'Flamespitter: 12 ticks over 3s against a target that stays in the cone.',
    'Electro Harpoon: 2 charges (engine ammo); the second harpoon on a target slowed by the first applies the enhanced MR shred.',
    'The Equalizer: full trail duration (18 ticks over 4.5s, matching the game\'s TotalDamage) by default; set R{burn:N} for shorter exposure.',
  ],
  abilities: {
    P: {
      noTarget: true,
      notes: ['Overheat (when Heat reaches 150): Rumble is silenced but gains attack speed and on-hit magic damage.'],
      buff: {
        id: 'rumbleOverheat',
        label: 'Overheat',
        duration: 'P.dv.OverheatDuration',
        stats: { attackSpeed: 'P.calc.OverheatAS' },
        onHit: [{ id: 'overheat', label: 'Overheat', type: 'magic', amount: 'P.calc.TotalBaseDamage + P.dv.OverheatPercBonusDamage * target.maxHp', proc: true }],
      },
      components: [],
    },
    Q: {
      components: [
        {
          id: 'flame',
          label: 'Flamespitter',
          type: 'magic',
          amount: '(calc.FlatDamage + dv.HealthDamage * target.maxHp) / dv.TotalTicks',
          hits: 'dv.TotalTicks',
          interval: 'dv.TickRate',
          delay: 'dv.TickRate',
          aoe: true,
          dot: true,
        },
      ],
      variants: {
        dz: {
          label: 'Danger Zone',
          components: [
            {
              id: 'flame',
              label: 'Flamespitter (Danger Zone)',
              type: 'magic',
              amount: '(calc.EmpoweredDamage + calc.EmpoweredHealth * target.maxHp) / dv.TotalTicks',
              hits: 'dv.TotalTicks',
              interval: 'dv.TickRate',
              delay: 'dv.TickRate',
              aoe: true,
              dot: true,
            },
          ],
        },
      },
    },
    W: { noTarget: true, notes: ['Shield and move speed; not modeled.'], components: [] },
    E: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      debuff: harpoonShred('1'),
      components: [{ id: 'harpoon', label: 'Electro Harpoon', type: 'magic', amount: 'calc.TotalDamage', travel: true }],
      variants: {
        dz: {
          label: 'Danger Zone',
          cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
          debuff: harpoonShred('1.5'),
          components: [{ id: 'harpoon', label: 'Electro Harpoon (Danger Zone)', type: 'magic', amount: 'calc.EmpDamage', travel: true }],
        },
      },
    },
    R: {
      notes: ['The rocket line is assumed drawn from Rumble through the target; the trail burns every 0.25s.'],
      cc: [{ kind: 'slow', duration: 'dv.TrailDuration' }],
      components: [
        {
          id: 'burn',
          label: 'The Equalizer',
          type: 'magic',
          amount: 'calc.DamagePerSecond * dv.TickRate',
          hits: 'dv.TrailDuration / dv.TickRate',
          maxHits: 'dv.TrailDuration / dv.TickRate',
          interval: 'dv.TickRate',
          // Wiki: the barrage starts 0.5833s after the cast and is laid along the path at the vector's
          // speed, damaging up to 1135 units forward: it reaches the target at that speed.
          delay: 0.5833,
          travel: 'min(distance, 1135) / missileSpeed',
          aoe: true,
          dot: true,
        },
      ],
    },
  },
};
export default kit;
