// ---- Deterministic PRNG (xorshift32) ----
// Seed must be a 32-bit non-zero integer. We coerce & sanitize.
function xorshift32(seed: number) {
  let x = (seed | 0) || 1; // ensure non-zero int
  return function rnd() {
    // xorshift32
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    // Convert to [0,1)
    // >>> 0 makes it unsigned, / 2^32 to [0,1)
    return ((x >>> 0) / 4294967296);
  };
}

// ---- Fisher–Yates shuffle with seeded RNG ----
export function shuffleWithSeed<T>(arr: readonly T[], seed: number): T[] {
  const a = arr.slice();                 // preserves T[]
  const rnd = xorshift32((seed | 0) ^ 0x9E3779B9);

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

// Classic US Bingo ranges as fixed-length tuples
const RANGES: Record<"B"|"I"|"N"|"G"|"O", [number, number]> = {
  B: [1, 15],
  I: [16, 30],
  N: [31, 45],
  G: [46, 60],
  O: [61, 75],
};

// Safer range-pick: validates lo/hi and clamps k
function pickKFromRange(k: number, lo: number, hi: number, seed: number) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    throw new Error(`Invalid range: lo=${lo}, hi=${hi}`);
  }
  if (hi < lo) {
    // Swap if accidentally inverted
    const t = lo; lo = hi; hi = t;
  }
  const len = (hi - lo + 1) | 0;
  if (len <= 0) {
    throw new Error(`Non-positive range length computed: lo=${lo}, hi=${hi}`);
  }
  const pool = Array.from({ length: len }, (_, i) => lo + i);
  const shuffled = shuffleWithSeed(pool, seed);
  const take = Math.min(Math.max(k, 0), len);
  return shuffled.slice(0, take);
}

// Create a single 5x5 card; FREE center is 0
export function makeCard(seed: number, salt: number): number[][] {
  const sB = (seed ^ (salt + 0x11)) | 0;
  const sI = (seed ^ (salt + 0x22)) | 0;
  const sN = (seed ^ (salt + 0x33)) | 0;
  const sG = (seed ^ (salt + 0x44)) | 0;
  const sO = (seed ^ (salt + 0x55)) | 0;

  const b = pickKFromRange(5, ...RANGES.B, sB);
  const i = pickKFromRange(5, ...RANGES.I, sI);
  const n = pickKFromRange(5, ...RANGES.N, sN);
  const g = pickKFromRange(5, ...RANGES.G, sG);
  const o = pickKFromRange(5, ...RANGES.O, sO);

  const grid: number[][] = Array.from({ length: 5 }, () => Array(5).fill(0));
  for (let r = 0; r < 5; r++) grid[r][0] = b[r];
  for (let r = 0; r < 5; r++) grid[r][1] = i[r];
  for (let r = 0; r < 5; r++) grid[r][2] = n[r];
  for (let r = 0; r < 5; r++) grid[r][3] = g[r];
  for (let r = 0; r < 5; r++) grid[r][4] = o[r];

  // FREE space
  grid[2][2] = 0;
  return grid;
}

// 1..75 shuffled deck
export function makeDeck(seed: number): number[] {
  const all = Array.from({ length: 75 }, (_, i) => i + 1);
  return shuffleWithSeed(all, (seed | 0) ^ 0xABC123);
}

// Validate "line" bingo (row, column, or diagonal)
export function hasLineBingo(card: number[][], calledSet: Set<number>): boolean {
  const isMarked = (v: number) => v === 0 || calledSet.has(v);

  // rows
  for (let r = 0; r < 5; r++) if (card[r].every(isMarked)) return true;
  // cols
  for (let c = 0; c < 5; c++) if ([0,1,2,3,4].every((r) => isMarked(card[r][c]))) return true;
  // diagonals
  if ([0,1,2,3,4].every((i) => isMarked(card[i][i]))) return true;
  if ([0,1,2,3,4].every((i) => isMarked(card[i][4 - i]))) return true;

  return false;
}
