export type Player = {
  id: string;        // socket.id
  name: string;
  card: number[][];  // 5x5, 0 = FREE center
};

export type RoundWinner = {
  playerId: string;
  name: string;
  pattern: string;   // "line" (MVP)
  at: number;        // called length at win time
};

export type RoomState = {
  code: string;
  seed: number;
  deck: number[];
  called: number[];
  players: Map<string, Player>;
  started: boolean;
  pattern: "line";
  roundId: number;         // increments each start
  winners: RoundWinner[];  // all winners this round
};

export type BingoWinner = {
  playerId: string;
  name: string;
  pattern: string;
  proofCard: number[][];
  at: number;  // called length
  roundId: number;
};
