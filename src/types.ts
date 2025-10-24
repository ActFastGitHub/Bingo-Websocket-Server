import type { PatternType } from "./patterns";

export type Player = {
  // A player is keyed by stable clientId, not socket.id
  clientId: string;
  name: string;
  // Multiple cards support
  cards: number[][][];          // array of 5x5 cards
  activeCard: number;           // current card index (0-based)
  // Preferences
  autoMark?: boolean;
  manual?: boolean;
  // Per-card manual marks
  marks: [number, number][][];  // same length as cards
  // Anti-spam
  lastClaimAt?: number;
  // Last known socket id (for targeted emits)
  lastSocketId?: string;
};

export type BingoWinner = {
  playerId: string;    // clientId
  name: string;
  cardIndex: number;   // which card won
  pattern: string;
  proofCard: number[][];
  at: number;
  roundId: number;
};

export type RoundWinner = { playerId: string; name: string; pattern: string; at: number; cardIndex: number };

export type RoomState = {
  code: string;
  seed: number;
  deck: number[];
  called: number[];
  // players keyed by clientId
  players: Map<string, Player>;
  started: boolean;
  pattern: PatternType;
  allowAutoMark: boolean;
  roundId: number;
  winners: RoundWinner[];
};
