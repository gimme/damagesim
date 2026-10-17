// Icons: an image, or the name's initials where there is none; and a damage source's mark.

import { useEffect, useState } from 'react';
import { DATA, abilityIcon, autoAttackIcon, championIcon, itemIcon, runeIcon, summonerIcon } from '../data.ts';

/** What stands in for a missing icon: the first letters of the name's first two words. */
export const initials = (label: string) =>
  label
    .replace(/[^A-Za-z ]/g, '')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function Icon({ src, label, size = '' }: { src: string; label: string; size?: '' | 'xs' | 'sm' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed)
    return (
      <span className={`icon ${size}`} aria-hidden>
        {initials(label)}
      </span>
    );
  return <img className={`icon ${size}`} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export const ChampIcon = ({ id, size = '' }: { id: string; size?: '' | 'sm' | 'lg' }) => <Icon src={championIcon(id)} label={DATA.champions[id]?.name ?? id} size={size} />;
export const ItemIcon = ({ id, size = '' }: { id: number; size?: '' | 'sm' | 'lg' }) => <Icon src={itemIcon(id)} label={DATA.items[id]?.name ?? String(id)} size={size} />;
export const RuneIcon = ({ id }: { id: number }) => {
  const r = DATA.runes.find((x) => x.id === id);
  return <Icon src={r ? runeIcon(r.icon) : ''} label={r?.name ?? String(id)} size="sm" />;
};

/**
 * A damage source in a few letters, with its icon when it has one: the key of an ability (Q, P, AA),
 * else the first letters of its name's words (ER for Essence Reaver, BoTRK), or of a one-word name its
 * first two, so it isn't taken for an ability (EL for Electrocute, not E).
 */
export function sourceMark(source: string, label: string, champion: string): { text: string; icon: string } {
  if (source === 'P' || source === 'Q' || source === 'W' || source === 'E' || source === 'R') return { text: source, icon: abilityIcon(champion, source) };
  if (source === 'AA') return { text: 'AA', icon: autoAttackIcon() };
  const words = label.split(/[\s-]+/).map((w) => w.replace(/[^\p{L}\d]/gu, ''));
  const text = words.length === 1 ? words[0].slice(0, 2).toUpperCase() : words.map((w) => w[0] ?? '').join('');
  const [kind, id] = source.split(':');
  const rune = kind === 'rune' ? DATA.runes.find((r) => r.id === Number(id)) : undefined;
  const icon = kind === 'item' ? itemIcon(Number(id)) : rune ? runeIcon(rune.icon) : source === 'summoner:ignite' ? summonerIcon('SummonerDot') : '';
  return { text, icon };
}
