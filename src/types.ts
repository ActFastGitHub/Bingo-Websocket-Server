import type { PatternType } from "./patterns";

export type Player = {
  clientId: string;
  name: string;
  cards: number[][][];
  activeCard: number;
  autoMark?: boolean;
  manual?: boolean;
  marks: [number, number][][];
  lastClaimAt?: number;
  lastSocketId?: string; // ephemeral
};

export type BingoWinner = {
  playerId: string;
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
  players: Map<string, Player>;
  started: boolean;
  pattern: PatternType;
  allowAutoMark: boolean;
  lockLobbyOnStart: boolean;
  locked: boolean;
  roundId: number;
  winners: RoundWinner[];
  hostKey: string;           // NEW – secret required for host actions
};
