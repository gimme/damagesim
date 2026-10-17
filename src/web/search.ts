// The champion and item pickers' search: which names match what's typed, best first.

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Whether `q`'s letters all appear in `s` in order, with any letters between: "rfc" is in "rapidfirecannon". */
const hasInOrder = (s: string, q: string) => {
  let i = 0;
  for (const c of s) if (c === q[i]) i++;
  return i === q.length;
};

/** Words an abbreviation can pass over without skipping anything: "ibl" is all of Ionian Boots of Lucidity. */
const MINOR_WORDS = new Set(["a", "an", "and", "at", "for", "in", "of", "on", "the", "to"]);

type Piece = { word: number; length: number };

/**
 * The ways `q` abbreviates a name from word `w` on: each piece of `q` starts a word, in turn, passing
 * over any ("bork" is Blade of the Ruined King).
 */
const abbreviations = (words: string[], q: string, w: number): Piece[][] => {
  const ways: Piece[][] = [];
  for (let k = 1; k <= q.length && words[w]?.[k - 1] === q[k - 1]; k++) {
    const rest = q.slice(k);
    if (!rest) ways.push([{ word: w, length: k }]);
    for (let i = w + 1; rest && i < words.length; i++) for (const way of abbreviations(words, rest, i)) ways.push([{ word: w, length: k }, ...way]);
  }
  return ways;
};

/**
 * How closely a name matches a search, higher first, or -1 if it doesn't hold its letters in order.
 * Best are the initials of the whole name ("ac" is Ardent Censer, "ibl" Ionian Boots of Lucidity), then
 * a prefix of it ("hor" is Horizon Focus), then initials that stop short, start at a later word or skip
 * one ("co" in Catalyst of Aeons), then a prefix of a later word ("edge" in Infinity Edge), then pieces
 * of words ("ho" and "r" in Hollow Radiance); among each, those skipping the fewest words, then leaving
 * the fewest after. Words like "of" don't count. Then come the letters unbroken in a word ("er" in
 * Actualizer), then with letters between, from a word's start ("dcap" in Rabadon's Deathcap) before not.
 */
const matchRank = (name: string, q: string) => {
  const n = norm(name);
  if (!hasInOrder(n, q)) return -1;
  if (!q) return 0;
  const words = name
    .split(/[\s-]+/)
    .map(norm)
    .filter(Boolean);
  let best = -1;
  for (let w = 0; w < words.length; w++)
    for (const pieces of abbreviations(words, q, w)) {
      const last = pieces[pieces.length - 1].word;
      const passedOver = (word: string, i: number) => !MINOR_WORDS.has(word) && !pieces.some((p) => p.word === i);
      const skipped = words.filter((word, i) => i < last && passedOver(word, i)).length;
      const after = words.filter((word, i) => i > last && passedOver(word, i)).length;
      const initials = pieces.length > 1 && pieces.every((p) => p.length === 1);
      const tier = initials && !skipped && !after ? 4 : pieces.length === 1 && !skipped ? 3 : initials ? 2 : pieces.length === 1 ? 1 : 0;
      best = Math.max(best, 300 + 100 * tier - 10 * skipped - after);
    }
  if (best >= 0) return best;
  return n.includes(q) ? 200 : words.some((w, i) => w[0] === q[0] && hasInOrder(words.slice(i).join(""), q)) ? 100 : 0;
};

/** The things whose names match a search, best first. */
export const search = <T>(things: T[], name: (t: T) => string, q: string) => {
  const nq = norm(q);
  return things
    .map((t) => ({ t, rank: matchRank(name(t), nq) }))
    .filter((m) => m.rank >= 0)
    .sort((a, b) => b.rank - a.rank)
    .map((m) => m.t);
};
