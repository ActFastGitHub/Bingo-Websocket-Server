// export type PatternType = "line" | "diagonal" | "blackout" | "cross" | "t" | "l";

// const zeros = (n: number) => Array(n).fill(0);

// const col = (c: number) =>
//   Array.from({ length: 5 }, () => zeros(5)).map((row, j) =>
//     row.map((_, jj) => (jj === c ? 1 : 0))
//   );

// const row = (r: number) =>
//   Array.from({ length: 5 }, (_, i) => (i === r ? Array(5).fill(1) : zeros(5)));

// const diagMain = [
//   [1,0,0,0,0],
//   [0,1,0,0,0],
//   [0,0,1,0,0],
//   [0,0,0,1,0],
//   [0,0,0,0,1],
// ];

// const diagAnti = [
//   [0,0,0,0,1],
//   [0,0,0,1,0],
//   [0,0,1,0,0],
//   [0,1,0,0,0],
//   [1,0,0,0,0],
// ];

// const crossMask = (() => {
//   const m = Array.from({ length: 5 }, () => zeros(5));
//   for (let i = 0; i < 5; i++) { m[2][i] = 1; m[i][2] = 1; }
//   return m;
// })();

// const tMask = (() => {
//   const m = Array.from({ length: 5 }, () => zeros(5));
//   for (let i = 0; i < 5; i++) m[0][i] = 1;
//   for (let i = 0; i < 5; i++) m[i][2] = 1;
//   return m;
// })();

// const lMask = (() => {
//   const m = Array.from({ length: 5 }, () => zeros(5));
//   for (let i = 0; i < 5; i++) m[i][0] = 1;
//   for (let i = 0; i < 5; i++) m[4][i] = 1;
//   return m;
// })();

// export function hasPattern(card: number[][], called: Set<number>, pattern: PatternType): boolean {
//   const isMarked = (r: number, c: number) => card[r][c] === 0 || called.has(card[r][c]);

//   const requireMask = (mask: number[][]) => {
//     for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
//       if (mask[r][c] && !isMarked(r, c)) return false;
//     }
//     return true;
//   };

//   if (pattern === "blackout") {
//     for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
//       if (!isMarked(r, c)) return false;
//     }
//     return true;
//   }

//   if (pattern === "line") {
//     for (let r = 0; r < 5; r++) if (requireMask(row(r))) return true;
//     for (let c = 0; c < 5; c++) if (requireMask(col(c))) return true;
//     return false;
//   }

//   if (pattern === "diagonal") return requireMask(diagMain) || requireMask(diagAnti);
//   if (pattern === "cross")    return requireMask(crossMask);
//   if (pattern === "t")        return requireMask(tMask);
//   if (pattern === "l")        return requireMask(lMask);

//   return false;
// }


// patterns.ts
export type PatternType = "line" | "x" | "plus" | "blackout" | "corners" | "t" | "l";

// Build a boolean grid from a numeric card and called numbers.
// Treat 0 (FREE) as always marked.
function toMarkedGrid(card: number[][], called: Set<number>): boolean[][] {
  return card.map((row, r) =>
    row.map((v, c) => v === 0 || called.has(v) || (r === 2 && c === 2)) // center is FREE, too
  );
}

const inb = (r: number, c: number) => r >= 0 && r < 5 && c >= 0 && c < 5;
const M = [0, 1, 2, 3, 4];

// Low-level checker on a boolean grid (true = marked)
export function matchesPattern(grid: boolean[][], p: PatternType): boolean {
  const g = grid;

  const is = (r: number, c: number) => (inb(r, c) ? !!g[r][c] : false);

  const row = (r: number) => M.every((c) => is(r, c));
  const col = (c: number) => M.every((r) => is(r, c));
  const mainDiag = M.every((i) => is(i, i));
  const antiDiag = M.every((i) => is(i, 4 - i));

  switch (p) {
    case "blackout":
      return M.every((r) => M.every((c) => is(r, c)));

    case "line":
      return M.some((i) => row(i) || col(i));

    case "x":
      return mainDiag && antiDiag;

    case "plus":
      return row(2) && col(2);

    case "corners":
      // ✅ Only the four corners must be marked
      return is(0, 0) && is(0, 4) && is(4, 0) && is(4, 4);

    case "t":
      // Top row + middle column
      return row(0) && col(2);

    case "l":
      // Left column + bottom row
      return col(0) && row(4);

    default:
      return false;
  }
}

// High-level API used by index.ts (card + called set)
export function hasPattern(card: number[][], called: Set<number>, pattern: PatternType): boolean {
  const grid = toMarkedGrid(card, called);
  return matchesPattern(grid, pattern);
}
