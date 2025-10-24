export type PatternType = "line" | "diagonal" | "blackout" | "cross" | "t" | "l";

const zeros = (n: number) => Array(n).fill(0);

const col = (c: number) =>
  Array.from({ length: 5 }, () => zeros(5)).map((row, j) =>
    row.map((_, jj) => (jj === c ? 1 : 0))
  );

const row = (r: number) =>
  Array.from({ length: 5 }, (_, i) => (i === r ? Array(5).fill(1) : zeros(5)));

const diagMain = [
  [1,0,0,0,0],
  [0,1,0,0,0],
  [0,0,1,0,0],
  [0,0,0,1,0],
  [0,0,0,0,1],
];

const diagAnti = [
  [0,0,0,0,1],
  [0,0,0,1,0],
  [0,0,1,0,0],
  [0,1,0,0,0],
  [1,0,0,0,0],
];

const crossMask = (() => {
  const m = Array.from({ length: 5 }, () => zeros(5));
  for (let i = 0; i < 5; i++) { m[2][i] = 1; m[i][2] = 1; }
  return m;
})();

const tMask = (() => {
  const m = Array.from({ length: 5 }, () => zeros(5));
  for (let i = 0; i < 5; i++) m[0][i] = 1;
  for (let i = 0; i < 5; i++) m[i][2] = 1;
  return m;
})();

const lMask = (() => {
  const m = Array.from({ length: 5 }, () => zeros(5));
  for (let i = 0; i < 5; i++) m[i][0] = 1;
  for (let i = 0; i < 5; i++) m[4][i] = 1;
  return m;
})();

export function hasPattern(card: number[][], called: Set<number>, pattern: PatternType): boolean {
  const isMarked = (r: number, c: number) => card[r][c] === 0 || called.has(card[r][c]);

  const requireMask = (mask: number[][]) => {
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      if (mask[r][c] && !isMarked(r, c)) return false;
    }
    return true;
  };

  if (pattern === "blackout") {
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      if (!isMarked(r, c)) return false;
    }
    return true;
  }

  if (pattern === "line") {
    for (let r = 0; r < 5; r++) if (requireMask(row(r))) return true;
    for (let c = 0; c < 5; c++) if (requireMask(col(c))) return true;
    return false;
  }

  if (pattern === "diagonal") return requireMask(diagMain) || requireMask(diagAnti);
  if (pattern === "cross")    return requireMask(crossMask);
  if (pattern === "t")        return requireMask(tMask);
  if (pattern === "l")        return requireMask(lMask);

  return false;
}
