// Tiny expression language used by champion kit definitions, e.g.
//   "calc.TotalDamage + 0.04 * target.maxHp"
//   "dv.BaseDamage + 0.6 * bonusAd"
//   "min(calc.Damage * (1 + target.missingHpPct), 2 * calc.Damage)"
//   "opt.stacks >= 3 ? calc.Empowered : calc.Normal"
//
// Identifiers are dotted paths resolved at evaluation time by a resolver callback, so the same
// compiled expression can be evaluated against different stats/targets cheaply.
// Names that are not valid identifiers (e.g. hashed calc names) use brackets: calc['{c61fdd37}'].

export type Resolver = (path: string[]) => number;
export type Compiled = (resolve: Resolver) => number;

type Tok = { k: "num"; v: number } | { k: "id"; v: string } | { k: "str"; v: string } | { k: "op"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c) && !(c === "." && !/[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(src.slice(i))!;
      out.push({ k: "num", v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i))!;
      out.push({ k: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new Error(`unterminated string in "${src}"`);
      out.push({ k: "str", v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "==", "!=", "&&", "||"].includes(two)) {
      out.push({ k: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/%^()?:,<>!.[]".includes(c)) {
      out.push({ k: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`unexpected "${c}" in expression "${src}"`);
  }
  return out;
}

const FUNCS: Record<string, (...a: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sqrt: Math.sqrt,
  clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
  lerp: (a, b, t) => a + (b - a) * t,
  /** Value by champion level 1-18 interpolated linearly: lvl(start, end) needs `level` → use lerp(a,b,(level-1)/17). */
};

const BINARY: Record<string, [number, (a: number, b: number) => number]> = {
  "||": [1, (a, b) => (a || b ? 1 : 0)],
  "&&": [2, (a, b) => (a && b ? 1 : 0)],
  "==": [3, (a, b) => (a === b ? 1 : 0)],
  "!=": [3, (a, b) => (a !== b ? 1 : 0)],
  "<": [4, (a, b) => (a < b ? 1 : 0)],
  "<=": [4, (a, b) => (a <= b ? 1 : 0)],
  ">": [4, (a, b) => (a > b ? 1 : 0)],
  ">=": [4, (a, b) => (a >= b ? 1 : 0)],
  "+": [5, (a, b) => a + b],
  "-": [5, (a, b) => a - b],
  "*": [6, (a, b) => a * b],
  "/": [6, (a, b) => (b === 0 ? 0 : a / b)],
  "%": [6, (a, b) => a % b],
  "^": [7, (a, b) => Math.pow(a, b)],
};

class Parser {
  private i = 0;
  private toks: Tok[];
  readonly src: string;
  readonly paths: string[][] = [];

  constructor(src: string) {
    this.src = src;
    this.toks = tokenize(src);
  }

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }
  private isOp(v: string) {
    const t = this.peek();
    return t?.k === "op" && t.v === v;
  }
  private expect(v: string) {
    if (!this.isOp(v)) throw new Error(`expected "${v}" in expression "${this.src}"`);
    this.i++;
  }

  parse(): Compiled {
    const e = this.ternary();
    if (this.i < this.toks.length) throw new Error(`unexpected token in expression "${this.src}"`);
    return e;
  }

  private ternary(): Compiled {
    const cond = this.binary(1);
    if (this.isOp("?")) {
      this.i++;
      const a = this.ternary();
      this.expect(":");
      const b = this.ternary();
      return (r) => (cond(r) ? a(r) : b(r));
    }
    return cond;
  }

  private binary(minPrec: number): Compiled {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (t?.k !== "op" || !BINARY[t.v] || BINARY[t.v][0] < minPrec) return left;
      const [prec, fn] = BINARY[t.v];
      this.i++;
      // ^ is right-associative
      const right = this.binary(t.v === "^" ? prec : prec + 1);
      const l = left;
      left = (r) => fn(l(r), right(r));
    }
  }

  private unary(): Compiled {
    if (this.isOp("-")) {
      this.i++;
      const e = this.unary();
      return (r) => -e(r);
    }
    if (this.isOp("+")) {
      this.i++;
      return this.unary();
    }
    if (this.isOp("!")) {
      this.i++;
      const e = this.unary();
      return (r) => (e(r) ? 0 : 1);
    }
    return this.primary();
  }

  private primary(): Compiled {
    const t = this.peek();
    if (!t) throw new Error(`unexpected end of expression "${this.src}"`);
    if (t.k === "num") {
      this.i++;
      const v = t.v;
      return () => v;
    }
    if (t.k === "op" && t.v === "(") {
      this.i++;
      const e = this.ternary();
      this.expect(")");
      return e;
    }
    if (t.k === "id") {
      this.i++;
      if (this.isOp("(")) {
        const fn = FUNCS[t.v];
        if (!fn) throw new Error(`unknown function ${t.v}() in "${this.src}"`);
        this.i++;
        const args: Compiled[] = [];
        if (!this.isOp(")")) {
          args.push(this.ternary());
          while (this.isOp(",")) {
            this.i++;
            args.push(this.ternary());
          }
        }
        this.expect(")");
        return (r) => fn(...args.map((a) => a(r)));
      }
      const path = [t.v];
      for (;;) {
        if (this.isOp(".")) {
          this.i++;
          const n = this.peek();
          if (n?.k !== "id") throw new Error(`expected name after "." in "${this.src}"`);
          path.push(n.v);
          this.i++;
        } else if (this.isOp("[")) {
          this.i++;
          const n = this.peek();
          if (n?.k !== "str") throw new Error(`expected string in [] in "${this.src}"`);
          path.push(n.v);
          this.i++;
          this.expect("]");
        } else break;
      }
      if (path.length === 1 && path[0] === "true") return () => 1;
      if (path.length === 1 && path[0] === "false") return () => 0;
      this.paths.push(path);
      return (r) => r(path);
    }
    throw new Error(`unexpected token in expression "${this.src}"`);
  }
}

const cache = new Map<string, { fn: Compiled; paths: string[][] }>();

export function compile(src: string | number): Compiled {
  if (typeof src === "number") return () => src;
  let c = cache.get(src);
  if (!c) {
    const p = new Parser(src);
    c = { fn: p.parse(), paths: p.paths };
    cache.set(src, c);
  }
  return c.fn;
}

/** The identifier paths an expression references (used for validation and explanations). */
export function references(src: string | number): string[][] {
  if (typeof src === "number") return [];
  compile(src);
  return cache.get(src)!.paths;
}

export function evaluate(src: string | number, resolve: Resolver): number {
  return compile(src)(resolve);
}
