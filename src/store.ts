// // src/store.ts
// import { getRedis } from "./redis";
// import type { RoomState } from "./types";

// const ROOM_PREFIX = "bingo:room";
// const roomKey = (code: string) => `${ROOM_PREFIX}:${code}`;

// /** Save a full room snapshot into Redis */
// export async function saveRoom(room: RoomState) {
//   const r = await getRedis();
//   await r.set(roomKey(room.code), JSON.stringify(room));
// }

// /** Load a room snapshot (rehydrates players Map) */
// export async function loadRoom(code: string): Promise<RoomState | null> {
//   const r = await getRedis();
//   const raw = await r.get(roomKey(code));
//   if (!raw) return null;

//   try {
//     const parsed = JSON.parse(raw) as RoomState & { players: any };
//     // Rehydrate Map if it was serialized as a plain object
//     if (parsed && parsed.players && !(parsed.players instanceof Map)) {
//       parsed.players = new Map<string, any>(
//         // when saved via JSON.stringify, Map becomes an object of { key: value }
//         Object.entries(parsed.players as Record<string, any>)
//       );
//     }
//     return parsed as RoomState;
//   } catch {
//     return null;
//   }
// }

// /** Delete a single room from Redis */
// export async function deleteRoom(code: string) {
//   const r = await getRedis();
//   await r.del(roomKey(code));
// }

// /** List all existing room codes found in Redis */
// export async function listRoomCodes(): Promise<string[]> {
//   const r = await getRedis();

//   // node-redis v4 supports KEYS; for small keyspaces this is fine.
//   // If you expect many thousands of rooms, swap this to SCAN.
//   const keys = await r.keys(`${ROOM_PREFIX}:*`);
//   // keys look like "bingo:room:ABC123" → extract the last segment
//   return keys.map((k) => k.slice(k.lastIndexOf(":") + 1)).sort();
// }

// /** Danger: delete ALL rooms from Redis */
// export async function deleteAllRooms(): Promise<number> {
//   const r = await getRedis();
//   const keys = await r.keys(`${ROOM_PREFIX}:*`);
//   if (!keys.length) return 0;
//   await r.del(keys);
//   return keys.length;
// }

// src/store.ts
import { getRedis } from "./redis";
import type { RoomState } from "./types";

const ROOM_PREFIX = "bingo:room";
const roomKey = (code: string) => `${ROOM_PREFIX}:${code}`;

export async function saveRoom(room: RoomState) {
	const r = await getRedis();
	await r.set(roomKey(room.code), JSON.stringify(room));
}

export async function loadRoom(code: string): Promise<RoomState | null> {
	const r = await getRedis();
	const raw = await r.get(roomKey(code));
	if (!raw) return null;

	try {
		const parsed = JSON.parse(raw) as RoomState & { players: any };
		if (parsed && parsed.players && !(parsed.players instanceof Map)) {
			parsed.players = new Map<string, any>(Object.entries(parsed.players as Record<string, any>));
		}
		return parsed as RoomState;
	} catch {
		return null;
	}
}

export async function deleteRoom(code: string) {
	const r = await getRedis();
	await r.del(roomKey(code));
}

/** For Join page discovery */
export async function listRoomCodes(): Promise<string[]> {
	const r = await getRedis();
	const keys = await r.keys(`${ROOM_PREFIX}:*`);
	return keys.map(k => k.slice(k.lastIndexOf(":") + 1)).sort();
}

/** Admin “nuke” helper */
export async function deleteAllRooms(): Promise<number> {
	const r = await getRedis();
	const keys = await r.keys(`${ROOM_PREFIX}:*`);
	if (!keys.length) return 0;
	await r.del(keys);
	return keys.length;
}
