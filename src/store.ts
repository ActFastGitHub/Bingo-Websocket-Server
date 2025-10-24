import type { RoomState, Player, RoundWinner } from "./types";
import { getRedis } from "./redis";

const ROOMS_SET = "bingo:rooms";
const ROOM_KEY = (code: string) => `bingo:room:${code}`;

function stripPlayer(p: Player): Omit<Player, "lastSocketId"> {
  const { lastSocketId, ...rest } = p;
  return rest;
}

function toPersist(room: RoomState) {
  return { ...room, players: Array.from(room.players.values()).map(stripPlayer) };
}

function fromPersist(raw: any): RoomState {
  const players = new Map<string, Player>();
  for (const p of raw.players as Player[]) players.set(p.clientId, { ...p });
  return {
    code: raw.code,
    seed: raw.seed,
    deck: raw.deck || [],
    called: raw.called || [],
    players,
    started: !!raw.started,
    pattern: raw.pattern,
    allowAutoMark: !!raw.allowAutoMark,
    lockLobbyOnStart: !!raw.lockLobbyOnStart,
    locked: !!raw.locked,
    roundId: raw.roundId || 0,
    winners: (raw.winners || []) as RoundWinner[],
  };
}

export async function saveRoom(room: RoomState): Promise<void> {
  const r = await getRedis();
  const key = ROOM_KEY(room.code);
  const json = JSON.stringify(toPersist(room));
  await r.multi().sAdd(ROOMS_SET, room.code).set(key, json).exec();
}

export async function loadRoom(code: string): Promise<RoomState | null> {
  const r = await getRedis();
  const json = await r.get(ROOM_KEY(code));
  if (!json) return null;
  return fromPersist(JSON.parse(json));
}

export async function deleteRoom(code: string): Promise<void> {
  const r = await getRedis();
  await r.multi().del(ROOM_KEY(code)).sRem(ROOMS_SET, code).exec();
}

export async function listRoomCodes(): Promise<string[]> {
  const r = await getRedis();
  const codes = await r.sMembers(ROOMS_SET);
  return (codes || []).sort();
}

export async function deleteAllRooms(): Promise<number> {
  const r = await getRedis();
  const codes = await r.sMembers(ROOMS_SET);
  if (!codes?.length) return 0;
  const multi = r.multi();
  for (const c of codes) multi.del(ROOM_KEY(c));
  multi.del(ROOMS_SET);
  await multi.exec();
  return codes.length;
}
