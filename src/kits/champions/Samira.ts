import type { ChampionKit, ComponentSpec } from '../../engine/kit-types.ts';

// Samira — patch 16.20.
// Daredevil Impulse: attacks and abilities in melee range deal bonus magic damage, +1% per 1% of
// the target's missing health (wiki). Applies to blade attacks, Blade Whirl, Wild Rush and Flair's
// slash — not the Flair gun shot or Inferno Trigger, and it is not an on-hit effect.
const melee = (id: string, label: string, extra: Partial<ComponentSpec> = {}): ComponentSpec => ({
  id,
  label,
  type: 'magic',
  amount: 'P.calc.BonusMeleeDamage * (1 + target.missingHpPct)',
  noProc: true,
  ...extra,
});

const kit: ChampionKit = {
  id: 'Samira',
  status: 'curated',
  notes: [
    'Option "melee" (on by default): Samira fights within melee range, so attacks are blade attacks and Flair is the sword slash, both adding Daredevil Impulse damage.',
    'Style grade is not tracked: Inferno Trigger can be cast whenever the combo asks for it (in game it needs an S rating).',
    'Flair and Inferno Trigger can crit; Flair crits for 50% of the bonus crit damage (CritDamageMod). Neither applies on-hit effects.',
    'Inferno Trigger: 10 shots over 2s (tooltip), all hitting the single target.',
  ],
  options: [{ key: 'melee', label: 'Fighting in melee range', default: 1, toggle: true, description: 'Blade attacks and Flair\'s slash add Daredevil Impulse magic damage.' }],
  attack: {
    onHit: [melee('impulse', 'Daredevil Impulse', { hits: 'opt.melee ? 1 : 0' })],
  },
  abilities: {
    Q: {
      components: [
        {
          id: 'flair',
          label: 'Flair',
          type: 'physical',
          amount: 'calc.DamageCalc',
          canCrit: true,
          critMultiplier: '1 + dv.CritDamageMod * (critDamage - 1)',
          // At the end of the cast time (wiki): the slash hits at once, the gun shot flies its range.
          travel: 'opt.melee ? 0 : castRange / missileSpeed',
        },
        melee('impulse', 'Daredevil Impulse', { hits: 'opt.melee ? 1 : 0' }),
      ],
    },
    W: {
      notes: ['Two slashes: immediately and after 0.75s (SlashDuration); each adds Daredevil Impulse damage.'],
      // Wiki: the 0.1s cast time has no effect, the first slash is immediate.
      castTime: 0,
      // Wiki: free to move, but can't attack nor cast Flair during the whirl.
      attackLockout: 'dv.SlashDuration',
      castLockout: { Q: 'dv.SlashDuration' },
      components: [
        { id: 'whirl', label: 'Blade Whirl', type: 'physical', amount: 'calc.DamageCalc', hits: 2, interval: 'dv.SlashDuration', aoe: true },
        melee('impulse', 'Daredevil Impulse', { hits: 2, interval: 'dv.SlashDuration' }),
      ],
    },
    E: {
      dash: true,
      // Wiki: Flair and Inferno Trigger can be cast during the dash; Blade Whirl waits for its end.
      attackLockout: 'castRange / missileSpeed',
      castLockout: { W: 'castRange / missileSpeed' },
      buff: { id: 'samiraE', label: 'Wild Rush', duration: 'dv.AttackSpeedDuration', stats: { attackSpeed: 'dv.BonusAttackSpeed' } },
      components: [
        { id: 'rush', label: 'Wild Rush', type: 'magic', amount: 'calc.DashDamage', aoe: true, travel: true },
        melee('impulse', 'Daredevil Impulse', { travel: true }),
      ],
    },
    R: {
      // Wiki: free to move, but can't attack nor cast Flair or Blade Whirl during the 2.25s torrent.
      attackLockout: 2.25,
      castLockout: { Q: 2.25, W: 2.25 },
      components: [
        {
          id: 'shot',
          label: 'Inferno Trigger',
          type: 'physical',
          amount: 'calc.DamageCalc',
          // 10 shots over 2 seconds (tooltip text).
          hits: 10,
          maxHits: 10,
          interval: 0.2,
          canCrit: true,
          aoe: true,
        },
      ],
    },
  },
};
export default kit;
