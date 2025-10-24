import type { PatternType } from "./patterns";

export type Player = {
  clientId: string;                 // stable identity
  name: string;                     // sticky name for this room
  cards: number[][][];              // multiple 5x5 cards
  activeCard: number;               // index
  autoMark?: boolean;
  manual?: boolean;
  marks: [number, number][][];      // per-card manual marks
  lastClaimAt?: number;
  lastSocketId?: string;
};

export type BingoWinner = {
  playerId: string;                 // clientId
  name: string;
  cardIndex: number;
  pattern: string;
  proofCard: number[][];
  at: number;
  roundId: number;
};

export type RoundWinner = {
  playerId: string;
  name: string;
  pattern: string;
  at: number;
  cardIndex: number;
};

export type RoomState = {
  code: string;
  seed: number;
  deck: number[];
  called: number[];
  players: Map<string, Player>;     // key = clientId
  started: boolean;
  pattern: PatternType;
  allowAutoMark: boolean;           // policy
  lockLobbyOnStart: boolean;        // host preference
  locked: boolean;                  // current room lock state (no new joins)
  roundId: number;
  winners: RoundWinner[];
};
