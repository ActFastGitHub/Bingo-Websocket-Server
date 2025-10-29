// // src/index.ts
// import express from "express";
// import http from "http";
// import cors from "cors";
// import { Server } from "socket.io";
// import { z } from "zod";
// import { createAdapter } from "@socket.io/redis-adapter";
// import { createClient } from "redis";

// import { RoomState, BingoWinner, RoundWinner } from "./types";
// import { makeCard, makeDeck } from "./game";
// import { PatternType, hasPattern } from "./patterns";
// import { saveRoom, loadRoom, deleteRoom as deleteRoomFromStore } from "./store";
// import { getRedis } from "./redis";
// import { mountAdmin } from "./admin";

// const norm = (s: string) => s.trim().toUpperCase();
// const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
// const makeHostKey = () =>
// 	[...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");

// const app = express();

// // ⚠️ Add your Vercel domain here
// const allowedOrigins = ["http://localhost:3000", "https://YOUR-VERCEL-APP.vercel.app"];
// app.use(cors({ origin: allowedOrigins, methods: ["GET", "POST"] }));

// mountAdmin(app);

// const server = http.createServer(app);
// const io = new Server(server, {
// 	cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
// 	transports: ["websocket", "polling"]
// });

// // Socket.IO Redis adapter
// async function setupAdapter() {
// 	const url = process.env.REDIS_URL;
// 	if (!url) {
// 		console.warn("REDIS_URL not set. Running without Socket.IO Redis adapter.");
// 		return;
// 	}
// 	const pub = createClient({ url });
// 	const sub = pub.duplicate();
// 	pub.on("error", e => console.error("Redis pub error:", e));
// 	sub.on("error", e => console.error("Redis sub error:", e));
// 	await pub.connect();
// 	await sub.connect();
// 	io.adapter(createAdapter(pub, sub));
// 	console.log("✅ Socket.IO Redis adapter enabled");
// }
// setupAdapter().catch(console.error);

// // in-memory cache + redis
// const rooms = new Map<string, RoomState>();
// async function getRoom(code: string) {
// 	const c = norm(code);
// 	return rooms.get(c) ?? (await loadRoom(c).then(r => (r && rooms.set(c, r), r)));
// }
// async function putRoom(room: RoomState) {
// 	rooms.set(room.code, room);
// 	await saveRoom(room);
// }
// async function forgetRoom(code: string) {
// 	rooms.delete(code);
// 	await deleteRoomFromStore(code);
// }

// const socketIndex = new Map<string, { code: string; clientId: string }>();
// function genRoomCode() {
// 	const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// 	let s = "";
// 	for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
// 	return s;
// }
// function randomSeed() {
// 	return Math.floor(Math.random() * 2 ** 31);
// }
// function hashStr(s: string) {
// 	let h = 2166136261;
// 	for (let i = 0; i < s.length; i++) {
// 		h ^= s.charCodeAt(i);
// 		h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
// 	}
// 	return Math.abs(h >>> 0);
// }

// function sanitizeMarks(m: [number, number][]) {
// 	const out: [number, number][] = [];
// 	const seen = new Set<string>();
// 	for (const [r, c] of m) {
// 		if (r < 0 || r > 4 || c < 0 || c > 4) continue;
// 		const k = `${r}-${c}`;
// 		if (!seen.has(k)) {
// 			seen.add(k);
// 			out.push([r, c]);
// 		}
// 		if (out.length >= 25) break;
// 	}
// 	return out;
// }

// function summarize(room: RoomState) {
// 	return {
// 		code: room.code,
// 		started: room.started,
// 		calledCount: room.called.length,
// 		last: room.called.length ? room.called[room.called.length - 1] : null,
// 		players: Array.from(room.players.values()).map(p => ({ id: p.clientId, name: p.name, cards: p.cards.length })),
// 		roundId: room.roundId,
// 		winners: room.winners,
// 		pattern: room.pattern,
// 		allowAutoMark: room.allowAutoMark,
// 		locked: room.locked,
// 		lockLobbyOnStart: room.lockLobbyOnStart
// 	};
// }

// const JoinSchema = z.object({
// 	code: z.string().trim().length(6),
// 	name: z.string().trim().min(1).max(40),
// 	clientId: z.string().trim().min(8).max(64),
// 	cardCount: z.number().int().min(1).max(4).default(1),
// 	autoMark: z.boolean().optional(),
// 	manual: z.boolean().optional(),
// 	marks: z.array(z.array(z.tuple([z.number().int(), z.number().int()]))).optional()
// });
// const KeySchema = z.object({ code: z.string().trim().length(6), hostKey: z.string().trim().min(8) });

// // ---------- SOCKET ----------
// io.on("connection", socket => {
// 	// probes
// 	socket.on("room:exists", async (code: string, cb: (r: { ok: boolean }) => void) =>
// 		cb({ ok: !!(await getRoom(code)) })
// 	);
// 	socket.on("room:watch", async (code: string, cb: (r: { ok: boolean; summary?: any; msg?: string }) => void) => {
// 		const room = await getRoom(code);
// 		if (!room) return cb({ ok: false, msg: "Room not found" });
// 		socket.join(room.code);
// 		cb({ ok: true, summary: summarize(room) });
// 	});

// 	// OPTIONAL: list current rooms for discovery on the join screen
// 	socket.on("room:list", async (cb: (r: { ok: boolean; rooms?: any[] }) => void) => {
// 		const list = Array.from(rooms.values()).map(summarize);
// 		cb({ ok: true, rooms: list });
// 	});

// 	// HOST create
// 	socket.on(
// 		"host:create_room",
// 		async (_: unknown, cb: (p: { code: string; seed: number; hostKey: string }) => void) => {
// 			const code = genRoomCode();
// 			const seed = randomSeed();
// 			const hostKey = makeHostKey();
// 			const room: RoomState = {
// 				code,
// 				seed,
// 				deck: makeDeck(seed),
// 				called: [],
// 				players: new Map(),
// 				started: false,
// 				pattern: "line",
// 				allowAutoMark: true,
// 				lockLobbyOnStart: true,
// 				locked: false,
// 				roundId: 0,
// 				winners: [],
// 				hostKey
// 			};
// 			await putRoom(room);
// 			socket.join(code);
// 			cb({ code, seed, hostKey });
// 			io.to(code).emit("room:updated", summarize(room));
// 		}
// 	);

// 	// HOST strict validations
// 	socket.on("host:set_pattern", async (payload: { code: string; hostKey: string; pattern: PatternType }) => {
// 		const p = KeySchema.safeParse(payload);
// 		if (!p.success) return;
// 		const room = await getRoom(p.data.code);
// 		if (!room || room.hostKey !== p.data.hostKey) return;
// 		if (room.started) return; // 🚫 cannot change pattern mid-round
// 		room.pattern = payload.pattern;
// 		await putRoom(room);
// 		io.to(room.code).emit("room:updated", summarize(room));
// 	});

// 	socket.on("host:set_allow_automark", async (payload: { code: string; hostKey: string; allow: boolean }) => {
// 		const p = KeySchema.safeParse(payload);
// 		if (!p.success) return;
// 		const room = await getRoom(p.data.code);
// 		if (!room || room.hostKey !== p.data.hostKey) return;
// 		room.allowAutoMark = !!payload.allow; // allowed mid-round
// 		if (!room.allowAutoMark) {
// 			for (const pl of room.players.values()) {
// 				pl.autoMark = false;
// 				pl.manual = true;
// 				if (pl.lastSocketId) io.to(pl.lastSocketId).emit("policy:allow_automark", false);
// 			}
// 		} else {
// 			for (const pl of room.players.values()) {
// 				if (pl.lastSocketId) io.to(pl.lastSocketId).emit("policy:allow_automark", true);
// 			}
// 		}
// 		await putRoom(room);
// 		io.to(room.code).emit("policy:allow_automark", room.allowAutoMark);
// 		io.to(room.code).emit("room:updated", summarize(room));
// 	});

// 	socket.on("host:set_lock_on_start", async (payload: { code: string; hostKey: string; lockOnStart: boolean }) => {
// 		const p = KeySchema.safeParse(payload);
// 		if (!p.success) return;
// 		const room = await getRoom(p.data.code);
// 		if (!room || room.hostKey !== p.data.hostKey) return;
// 		room.lockLobbyOnStart = !!payload.lockOnStart;
// 		await putRoom(room);
// 		io.to(room.code).emit("room:updated", summarize(room));
// 	});

// 	socket.on("host:set_locked", async (payload: { code: string; hostKey: string; locked: boolean }) => {
// 		const p = KeySchema.safeParse(payload);
// 		if (!p.success) return;
// 		const room = await getRoom(p.data.code);
// 		if (!room || room.hostKey !== p.data.hostKey) return;
// 		room.locked = !!payload.locked;
// 		await putRoom(room);
// 		io.to(room.code).emit("policy:locked", room.locked);
// 		io.to(room.code).emit("room:updated", summarize(room));
// 	});

// 	// START / END — ✅ True restart each round
// 	socket.on("host:start", async (payload: { code: string; hostKey: string }) => {
// 		const p = KeySchema.safeParse(payload);
// 		if (!p.success) return;
// 		const room = await getRoom(p.data.code);
// 		if (!room || room.hostKey !== p.data.hostKey) return;
// 		if (room.started) return; // 🚫 already started

// 		room.started = true;
// 		room.called = [];
// 		room.deck = makeDeck(room.seed);
// 		room.roundId += 1;
// 		room.winners = [];
// 		if (room.lockLobbyOnStart) {
// 			room.locked = true;
// 			io.to(room.code).emit("policy:locked", true);
// 		}

// 		// 🔄 NEW CARDS PER ROUND (deterministic on round)
// 		for (const pl of room.players.values()) {
// 			const count = clamp(pl.cards.length, 1, 4);
// 			const nextCards: number[][][] = [];
// 			for (let i = 0; i < count; i++) {
// 				const salt = hashStr(`${pl.clientId}#${room.roundId}#${i}`);
// 				nextCards.push(makeCard(room.seed, salt));
// 			}
// 			pl.cards = nextCards;
// 			pl.activeCard = 0;
// 			pl.marks = pl.cards.map(() => []);
// 			pl.lastClaimAt = 0;
// 			if (pl.lastSocketId)
// 				io.to(pl.lastSocketId).emit("player:new_round", {
// 					cards: pl.cards,
// 					activeCard: pl.activeCard,
// 					roundId: room.roundId
// 				});
// 		}

// 		await putRoom(room);
// 		io.to(room.code).emit("game:started", { code: room.code, roundId: room.roundId });
// 		io.to(room.code).emit("room:winners", room.winners);
// 		io.to(room.code).emit("room:updated", summarize(room));
// 	});

// 	socket.on("host:end_round", async (payload: { code: string; hostKey: string }) => {
// 		const p = KeySchema.safeParse(payload);
// 		if (!p.success) return;
// 		const room = await getRoom(p.data.code);
// 		if (!room || room.hostKey !== p.data.hostKey) return;
// 		if (!room.started) return;
// 		room.started = false; // keep called history visible until next start
// 		await putRoom(room);
// 		io.to(room.code).emit("game:ended", { code: room.code, roundId: room.roundId });
// 		io.to(room.code).emit("room:updated", summarize(room));
// 	});

// 	// CALL / UNDO
// 	socket.on("host:call_next", async (payload: { code: string; hostKey: string }) => {
// 		const p = KeySchema.safeParse(payload);
// 		if (!p.success) return;
// 		const room = await getRoom(p.data.code);
// 		if (!room || !room.started || room.hostKey !== p.data.hostKey) return;
// 		const next = room.deck.shift();
// 		if (!next) return; // 🚫 deck empty
// 		room.called.push(next);
// 		await putRoom(room);
// 		io.to(room.code).emit("game:called", { n: next, history: room.called, roundId: room.roundId });
// 	});

// 	socket.on("host:undo", async (payload: { code: string; hostKey: string }) => {
// 		const p = KeySchema.safeParse(payload);
// 		if (!p.success) return;
// 		const room = await getRoom(p.data.code);
// 		if (!room || !room.started || room.hostKey !== p.data.hostKey || room.called.length === 0) return;
// 		const last = room.called.pop()!;
// 		room.deck.unshift(last);
// 		await putRoom(room);
// 		io.to(room.code).emit("game:undo", { history: room.called, roundId: room.roundId });
// 	});

// 	// NEW: Host deletes room (true cleanup)
// 	socket.on(
// 		"host:delete_room",
// 		async (payload: { code: string; hostKey: string }, cb?: (r: { ok: boolean }) => void) => {
// 			const p = KeySchema.safeParse(payload);
// 			if (!p.success) return cb?.({ ok: false });
// 			const room = await getRoom(p.data.code);
// 			if (!room || room.hostKey !== p.data.hostKey) return cb?.({ ok: false });

// 			// Notify occupants, then disconnect them from the room
// 			io.to(room.code).emit("room:deleted", { code: room.code });
// 			for (const [sid, info] of socketIndex.entries()) {
// 				if (info.code === room.code) {
// 					const s = io.sockets.sockets.get(sid);
// 					s?.leave(room.code);
// 				}
// 			}

// 			await forgetRoom(room.code);
// 			cb?.({ ok: true });
// 		}
// 	);

// 	// PLAYER join / marks / claim
// 	socket.on("player:join", async (payload, cb) => {
// 		const parsed = JoinSchema.safeParse(payload);
// 		if (!parsed.success) return cb({ ok: false, msg: "Invalid join data" });
// 		const code = norm(parsed.data.code);
// 		let room = await getRoom(code);
// 		if (!room) return cb({ ok: false, msg: "Room not found" });

// 		socket.join(code);
// 		socket.join(parsed.data.clientId);
// 		socketIndex.set(socket.id, { code, clientId: parsed.data.clientId });

// 		let player = room.players.get(parsed.data.clientId);
// 		if (!player && room.locked) return cb({ ok: false, msg: "Lobby is locked. Please wait for the next round." });

// 		if (player) {
// 			player.lastSocketId = socket.id;
// 			await putRoom(room);
// 			return cb({
// 				ok: true,
// 				cards: player.cards,
// 				roundId: room.roundId,
// 				allowAutoMark: room.allowAutoMark,
// 				activeCard: player.activeCard,
// 				name: player.name
// 			});
// 		}

// 		const count = clamp(parsed.data.cardCount ?? 1, 1, 4);
// 		const cards: number[][][] = [];
// 		for (let i = 0; i < count; i++) {
// 			const salt = hashStr(`${parsed.data.clientId}#${room.roundId || 0}#${i}`); // round-aware
// 			cards.push(makeCard(room.seed, salt));
// 		}

// 		const useAuto = room.allowAutoMark ? parsed.data.autoMark ?? true : false;
// 		const useManual = room.allowAutoMark ? parsed.data.manual ?? !useAuto : true;
// 		const incomingMarks = parsed.data.marks ?? [];
// 		const marks = cards.map((_, i) => sanitizeMarks(incomingMarks[i] ?? []));

// 		player = {
// 			clientId: parsed.data.clientId,
// 			name: parsed.data.name,
// 			cards,
// 			activeCard: 0,
// 			autoMark: useAuto,
// 			manual: useManual,
// 			marks,
// 			lastClaimAt: 0,
// 			lastSocketId: socket.id
// 		};
// 		room.players.set(player.clientId, player);

// 		await putRoom(room);
// 		cb({
// 			ok: true,
// 			cards: player.cards,
// 			roundId: room.roundId,
// 			allowAutoMark: room.allowAutoMark,
// 			activeCard: player.activeCard,
// 			name: player.name
// 		});
// 		io.to(room.code).emit("room:updated", summarize(room));
// 	});

// 	socket.on("player:switch_card", async (code: string, clientId: string, cardIndex: number) => {
// 		const room = await getRoom(code);
// 		if (!room) return;
// 		const p = room.players.get(clientId);
// 		if (!p) return;
// 		p.activeCard = clamp(cardIndex, 0, p.cards.length - 1);
// 		await putRoom(room);
// 		io.to(clientId).emit("player:active_card", p.activeCard);
// 	});

// 	socket.on(
// 		"player:update_marks",
// 		async (code: string, clientId: string, cardIndex: number, marks: [number, number][]) => {
// 			const room = await getRoom(code);
// 			if (!room) return;
// 			const p = room.players.get(clientId);
// 			if (!p || !p.manual) return;
// 			const idx = clamp(cardIndex, 0, p.cards.length - 1);
// 			p.marks[idx] = sanitizeMarks(marks);
// 			await putRoom(room);
// 		}
// 	);

// 	socket.on(
// 		"player:claim_bingo",
// 		async (code: string, clientId: string, cardIndex: number, cb: (r: { ok: boolean; msg?: string }) => void) => {
// 			const room = await getRoom(code);
// 			if (!room) return cb({ ok: false, msg: "Room not found" });
// 			const player = room.players.get(clientId);
// 			if (!player) return cb({ ok: false, msg: "Player not in room" });
// 			const now = Date.now();
// 			if (player.lastClaimAt && now - player.lastClaimAt < 2000)
// 				return cb({ ok: false, msg: "Please wait before claiming again" });
// 			player.lastClaimAt = now;

// 			const idx = clamp(cardIndex, 0, player.cards.length - 1);
// 			const card = player.cards[idx];
// 			const calledSet = new Set(room.called);

// 			if (player.manual) {
// 				const before = player.marks[idx].length;
// 				player.marks[idx] = player.marks[idx].filter(([r, c]) => {
// 					const v = card?.[r]?.[c];
// 					return v === 0 || calledSet.has(v);
// 				});
// 				if (player.marks[idx].length !== before && player.lastSocketId)
// 					io.to(player.lastSocketId).emit("player:marks_corrected", {
// 						cardIndex: idx,
// 						marks: player.marks[idx]
// 					});
// 			}

// 			const valid = hasPattern(card, calledSet, room.pattern);
// 			if (!valid) return cb({ ok: false, msg: "Pattern not satisfied yet" });

// 			if (!room.winners.some(w => w.playerId === player.clientId)) {
// 				const winner: BingoWinner = {
// 					playerId: player.clientId,
// 					name: player.name,
// 					cardIndex: idx,
// 					pattern: room.pattern,
// 					proofCard: card,
// 					at: room.called.length,
// 					roundId: room.roundId
// 				};
// 				const brief: RoundWinner = {
// 					playerId: winner.playerId,
// 					name: winner.name,
// 					pattern: winner.pattern,
// 					at: winner.at,
// 					cardIndex: idx
// 				};
// 				room.winners.push(brief);
// 				await putRoom(room);
// 				io.to(room.code).emit("game:winner", winner);
// 				io.to(room.code).emit("room:winners", room.winners);
// 				io.to(room.code).emit("room:updated", summarize(room));
// 			} else await putRoom(room);

// 			cb({ ok: true });
// 		}
// 	);

// 	socket.on("disconnecting", () => {
// 		const info = socketIndex.get(socket.id);
// 		if (info) socketIndex.delete(socket.id);
// 	});
// });

// app.get("/", (_req, res) => res.send("Bingo Realtime Server OK"));
// const PORT = Number(process.env.PORT || 4000);
// server.listen(PORT, "0.0.0.0", async () => {
// 	try {
// 		await getRedis();
// 		console.log("✅ Redis connected");
// 	} catch (e) {
// 		console.error("❌ Redis connection failed", e);
// 	}
// 	console.log(`✅ Socket.IO server on :${PORT}`);
// });


// src/index.ts	
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { z } from "zod";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";

import { RoomState, BingoWinner, RoundWinner } from "./types";
import { makeCard, makeDeck } from "./game";
import { PatternType, hasPattern } from "./patterns";
import { saveRoom, loadRoom, deleteRoom as deleteRoomFromStore, listRoomCodes } from "./store";
import { getRedis } from "./redis";
import { mountAdmin } from "./admin";

const norm = (s: string) => s.trim().toUpperCase();
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const makeHostKey = () =>
	[...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");

const app = express();
const allowedOrigins = ["http://localhost:3000", "https://YOUR-VERCEL-APP.vercel.app"];
app.use(cors({ origin: allowedOrigins, methods: ["GET", "POST"] }));
mountAdmin(app);

const server = http.createServer(app);
const io = new Server(server, {
	cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
	transports: ["websocket", "polling"]
});

// adapter
async function setupAdapter() {
	const url = process.env.REDIS_URL;
	if (!url) {
		console.warn("REDIS_URL not set. Running without Socket.IO Redis adapter.");
		return;
	}
	const pub = createClient({ url });
	const sub = pub.duplicate();
	pub.on("error", e => console.error("Redis pub error:", e));
	sub.on("error", e => console.error("Redis sub error:", e));
	await pub.connect();
	await sub.connect();
	io.adapter(createAdapter(pub, sub));
	console.log("✅ Socket.IO Redis adapter enabled");
}
setupAdapter().catch(console.error);

// memory + redis
const rooms = new Map<string, RoomState>();
async function getRoom(code: string) {
	const c = norm(code);
	return rooms.get(c) ?? (await loadRoom(c).then(r => (r && rooms.set(c, r), r)));
}
async function putRoom(room: RoomState) {
	rooms.set(room.code, room);
	await saveRoom(room);
}
async function forgetRoom(code: string) {
	rooms.delete(code);
	await deleteRoomFromStore(code);
}

const socketIndex = new Map<string, { code: string; clientId: string }>();
function genRoomCode() {
	const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	let s = "";
	for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
	return s;
}
function randomSeed() {
	return Math.floor(Math.random() * 2 ** 31);
}
function hashStr(s: string) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
	}
	return Math.abs(h >>> 0);
}
function sanitizeMarks(m: [number, number][]) {
	const out: [number, number][] = [];
	const seen = new Set<string>();
	for (const [r, c] of m) {
		if (r < 0 || r > 4 || c < 0 || c > 4) continue;
		const k = `${r}-${c}`;
		if (!seen.has(k)) {
			seen.add(k);
			out.push([r, c]);
		}
		if (out.length >= 25) break;
	}
	return out;
}
function summarize(room: RoomState) {
	return {
		code: room.code,
		started: room.started,
		paused: !!room.paused,
		calledCount: room.called.length,
		last: room.called.length ? room.called[room.called.length - 1] : null,
		players: Array.from(room.players.values()).map(p => ({ id: p.clientId, name: p.name, cards: p.cards.length })),
		roundId: room.roundId,
		winners: room.winners,
		pattern: room.pattern,
		allowAutoMark: room.allowAutoMark,
		locked: room.locked,
		lockLobbyOnStart: room.lockLobbyOnStart
	};
}

const JoinSchema = z.object({
	code: z.string().trim().length(6),
	name: z.string().trim().min(1).max(40),
	clientId: z.string().trim().min(8).max(64),
	cardCount: z.number().int().min(1).max(4).default(1),
	autoMark: z.boolean().optional(),
	manual: z.boolean().optional(),
	marks: z.array(z.array(z.tuple([z.number().int(), z.number().int()]))).optional()
});
const KeySchema = z.object({ code: z.string().trim().length(6), hostKey: z.string().trim().min(8) });

// ---------- SOCKET ----------
io.on("connection", socket => {
	// probes
	socket.on("room:exists", async (code: string, cb: (r: { ok: boolean }) => void) =>
		cb({ ok: !!(await getRoom(code)) })
	);
	socket.on("room:watch", async (code: string, cb: (r: { ok: boolean; summary?: any; msg?: string }) => void) => {
		const room = await getRoom(code);
		if (!room) return cb({ ok: false, msg: "Room not found" });
		socket.join(room.code);
		cb({ ok: true, summary: summarize(room) });
	});

	// discovery list comes from Redis to avoid stale cache if admin deleted
	socket.on("room:list", async (cb: (r: { ok: boolean; rooms?: any[] }) => void) => {
		const codes = await listRoomCodes();
		const roomsLoaded = await Promise.all(codes.map(c => loadRoom(c)));
		cb({ ok: true, rooms: roomsLoaded.filter(Boolean).map(r => summarize(r!)) });
	});

	// HOST create
	socket.on(
		"host:create_room",
		async (_: unknown, cb: (p: { code: string; seed: number; hostKey: string }) => void) => {
			const code = genRoomCode();
			const seed = randomSeed();
			const hostKey = makeHostKey();
			const room: RoomState = {
				code,
				seed,
				deck: makeDeck(seed),
				called: [],
				players: new Map(),
				started: false,
				paused: false,
				pattern: "line",
				allowAutoMark: true,
				lockLobbyOnStart: true,
				locked: false,
				roundId: 0,
				winners: [],
				hostKey
			};
			await putRoom(room);
			socket.join(code);
			cb({ code, seed, hostKey });
			io.to(code).emit("room:updated", summarize(room));
		}
	);

	// HOST settings (unchanged except we re-emit summarizes)
	socket.on("host:set_pattern", async (payload: { code: string; hostKey: string; pattern: PatternType }) => {
		const p = KeySchema.safeParse(payload);
		if (!p.success) return;
		const room = await getRoom(p.data.code);
		if (!room || room.hostKey !== p.data.hostKey) return;
		if (room.started) return;
		room.pattern = payload.pattern;
		await putRoom(room);
		io.to(room.code).emit("room:updated", summarize(room));
	});

	socket.on("host:set_allow_automark", async (payload: { code: string; hostKey: string; allow: boolean }) => {
		const p = KeySchema.safeParse(payload);
		if (!p.success) return;
		const room = await getRoom(p.data.code);
		if (!room || room.hostKey !== p.data.hostKey) return;
		room.allowAutoMark = !!payload.allow;
		if (!room.allowAutoMark) {
			for (const pl of room.players.values()) {
				pl.autoMark = false;
				pl.manual = true;
				if (pl.lastSocketId) io.to(pl.lastSocketId).emit("policy:allow_automark", false);
			}
		} else {
			for (const pl of room.players.values()) {
				if (pl.lastSocketId) io.to(pl.lastSocketId).emit("policy:allow_automark", true);
			}
		}
		await putRoom(room);
		io.to(room.code).emit("policy:allow_automark", room.allowAutoMark);
		io.to(room.code).emit("room:updated", summarize(room));
	});

	socket.on("host:set_lock_on_start", async (payload: { code: string; hostKey: string; lockOnStart: boolean }) => {
		const p = KeySchema.safeParse(payload);
		if (!p.success) return;
		const room = await getRoom(p.data.code);
		if (!room || room.hostKey !== p.data.hostKey) return;
		room.lockLobbyOnStart = !!payload.lockOnStart;
		await putRoom(room);
		io.to(room.code).emit("room:updated", summarize(room));
	});

	socket.on("host:set_locked", async (payload: { code: string; hostKey: string; locked: boolean }) => {
		const p = KeySchema.safeParse(payload);
		if (!p.success) return;
		const room = await getRoom(p.data.code);
		if (!room || room.hostKey !== p.data.hostKey) return;
		room.locked = !!payload.locked;
		await putRoom(room);
		io.to(room.code).emit("policy:locked", room.locked);
		io.to(room.code).emit("room:updated", summarize(room));
	});

	// START / END — true restart, clear paused
	socket.on("host:start", async (payload: { code: string; hostKey: string }) => {
		const p = KeySchema.safeParse(payload);
		if (!p.success) return;
		const room = await getRoom(p.data.code);
		if (!room || room.hostKey !== p.data.hostKey) return;
		if (room.started) return;
		room.started = true;
		room.paused = false;
		room.called = [];
		room.deck = makeDeck(room.seed);
		room.roundId += 1;
		room.winners = [];
		if (room.lockLobbyOnStart) {
			room.locked = true;
			io.to(room.code).emit("policy:locked", true);
		}
		// regenerate cards per round
		for (const pl of room.players.values()) {
			const count = clamp(pl.cards.length || 1, 1, 4);
			const next: number[][][] = [];
			for (let i = 0; i < count; i++) {
				const salt = hashStr(`${pl.clientId}#${room.roundId}#${i}`);
				next.push(makeCard(room.seed, salt));
			}
			pl.cards = next;
			pl.activeCard = 0;
			pl.marks = pl.cards.map(() => []);
			pl.lastClaimAt = 0;
			if (pl.lastSocketId)
				io.to(pl.lastSocketId).emit("player:new_round", {
					cards: pl.cards,
					activeCard: pl.activeCard,
					roundId: room.roundId
				});
		}
		await putRoom(room);
		io.to(room.code).emit("game:started", { code: room.code, roundId: room.roundId });
		io.to(room.code).emit("room:winners", room.winners);
		io.to(room.code).emit("room:updated", summarize(room));
	});

	socket.on("host:end_round", async (payload: { code: string; hostKey: string }) => {
		const p = KeySchema.safeParse(payload);
		if (!p.success) return;
		const room = await getRoom(p.data.code);
		if (!room || room.hostKey !== p.data.hostKey) return;
		if (!room.started) return;
		room.started = false;
		room.paused = false; // keep called history visible
		await putRoom(room);
		io.to(room.code).emit("game:ended", { code: room.code, roundId: room.roundId });
		io.to(room.code).emit("room:updated", summarize(room));
	});

	// CALL / UNDO — block when paused
	socket.on("host:call_next", async (payload: { code: string; hostKey: string }) => {
		const p = KeySchema.safeParse(payload);
		if (!p.success) return;
		const room = await getRoom(p.data.code);
		if (!room || !room.started || room.hostKey !== p.data.hostKey || room.paused) return;
		const next = room.deck.shift();
		if (!next) return;
		room.called.push(next);
		await putRoom(room);
		io.to(room.code).emit("game:called", { n: next, history: room.called, roundId: room.roundId });
	});

	socket.on("host:undo", async (payload: { code: string; hostKey: string }) => {
		const p = KeySchema.safeParse(payload);
		if (!p.success) return;
		const room = await getRoom(p.data.code);
		if (!room || !room.started || room.hostKey !== p.data.hostKey || room.called.length === 0 || room.paused)
			return;
		const last = room.called.pop()!;
		room.deck.unshift(last);
		await putRoom(room);
		io.to(room.code).emit("game:undo", { history: room.called, roundId: room.roundId });
	});

	// Host deletes room
	socket.on(
		"host:delete_room",
		async (payload: { code: string; hostKey: string }, cb?: (r: { ok: boolean }) => void) => {
			const p = KeySchema.safeParse(payload);
			if (!p.success) return cb?.({ ok: false });
			const room = await getRoom(p.data.code);
			if (!room || room.hostKey !== p.data.hostKey) return cb?.({ ok: false });
			io.to(room.code).emit("room:deleted", { code: room.code });
			for (const [sid, info] of socketIndex.entries()) {
				if (info.code === room.code) io.sockets.sockets.get(sid)?.leave(room.code);
			}
			await forgetRoom(room.code);
			cb?.({ ok: true });
		}
	);

	// PLAYER
	socket.on("player:join", async (payload, cb) => {
		const parsed = JoinSchema.safeParse(payload);
		if (!parsed.success) return cb({ ok: false, msg: "Invalid join data" });
		const code = norm(parsed.data.code);
		let room = await getRoom(code);
		if (!room) return cb({ ok: false, msg: "Room not found" });

		socket.join(code);
		socket.join(parsed.data.clientId);
		socketIndex.set(socket.id, { code, clientId: parsed.data.clientId });

		let player = room.players.get(parsed.data.clientId);
		if (!player && room.locked) return cb({ ok: false, msg: "Lobby is locked. Please wait for the next round." });

		if (player) {
			player.lastSocketId = socket.id;
			await putRoom(room);
			return cb({
				ok: true,
				cards: player.cards,
				roundId: room.roundId,
				allowAutoMark: room.allowAutoMark,
				activeCard: player.activeCard,
				name: player.name
			});
		}

		const count = clamp(parsed.data.cardCount ?? 1, 1, 4);
		const cards: number[][][] = [];
		for (let i = 0; i < count; i++) {
			const salt = hashStr(`${parsed.data.clientId}#${room.roundId || 0}#${i}`);
			cards.push(makeCard(room.seed, salt));
		}
		const useAuto = room.allowAutoMark ? parsed.data.autoMark ?? true : false;
		const useManual = room.allowAutoMark ? parsed.data.manual ?? !useAuto : true;
		const incomingMarks = parsed.data.marks ?? [];
		const marks = cards.map((_, i) => sanitizeMarks(incomingMarks[i] ?? []));

		player = {
			clientId: parsed.data.clientId,
			name: parsed.data.name,
			cards,
			activeCard: 0,
			autoMark: useAuto,
			manual: useManual,
			marks,
			lastClaimAt: 0,
			lastSocketId: socket.id
		};
		room.players.set(player.clientId, player);

		await putRoom(room);
		cb({
			ok: true,
			cards: player.cards,
			roundId: room.roundId,
			allowAutoMark: room.allowAutoMark,
			activeCard: player.activeCard,
			name: player.name
		});
		io.to(room.code).emit("room:updated", summarize(room));
	});

	socket.on("player:switch_card", async (code: string, clientId: string, cardIndex: number) => {
		const room = await getRoom(code);
		if (!room) return;
		const p = room.players.get(clientId);
		if (!p) return;
		p.activeCard = clamp(cardIndex, 0, p.cards.length - 1);
		await putRoom(room);
		io.to(clientId).emit("player:active_card", p.activeCard);
	});

	socket.on(
		"player:update_marks",
		async (code: string, clientId: string, cardIndex: number, marks: [number, number][]) => {
			const room = await getRoom(code);
			if (!room) return;
			const p = room.players.get(clientId);
			if (!p || !p.manual) return;
			const idx = clamp(cardIndex, 0, p.cards.length - 1);
			p.marks[idx] = sanitizeMarks(marks);
			await putRoom(room);
		}
	);

	// Claims are blocked when paused
	socket.on(
		"player:claim_bingo",
		async (code: string, clientId: string, cardIndex: number, cb: (r: { ok: boolean; msg?: string }) => void) => {
			const room = await getRoom(code);
			if (!room) return cb({ ok: false, msg: "Room not found" });
			if (room.paused) return cb({ ok: false, msg: "Round paused by host" });
			const player = room.players.get(clientId);
			if (!player) return cb({ ok: false, msg: "Player not in room" });

			const now = Date.now();
			if (player.lastClaimAt && now - player.lastClaimAt < 2000)
				return cb({ ok: false, msg: "Please wait before claiming again" });
			player.lastClaimAt = now;

			const idx = clamp(cardIndex, 0, player.cards.length - 1);
			const card = player.cards[idx];
			const calledSet = new Set(room.called);

			if (player.manual) {
				const before = player.marks[idx].length;
				player.marks[idx] = player.marks[idx].filter(([r, c]) => {
					const v = card?.[r]?.[c];
					return v === 0 || calledSet.has(v);
				});
				if (player.marks[idx].length !== before && player.lastSocketId)
					io.to(player.lastSocketId).emit("player:marks_corrected", {
						cardIndex: idx,
						marks: player.marks[idx]
					});
			}

			const valid = hasPattern(card, calledSet, room.pattern);
			if (!valid) return cb({ ok: false, msg: "Pattern not satisfied yet" });

			// first valid winner pauses the game
			if (!room.winners.some(w => w.playerId === player.clientId)) {
				const winner: BingoWinner = {
					playerId: player.clientId,
					name: player.name,
					cardIndex: idx,
					pattern: room.pattern,
					proofCard: card,
					at: room.called.length,
					roundId: room.roundId
				};
				const brief: RoundWinner = {
					playerId: winner.playerId,
					name: winner.name,
					pattern: winner.pattern,
					at: winner.at,
					cardIndex: idx
				};
				room.winners.push(brief);
				// ⏸️ Pause the round after first winner
				room.paused = true;
				await putRoom(room);
				io.to(room.code).emit("game:winner", winner);
				io.to(room.code).emit("room:winners", room.winners);
				io.to(room.code).emit("room:updated", summarize(room));
			} else {
				await putRoom(room);
			}

			cb({ ok: true });
		}
	);

	socket.on("disconnecting", () => {
		const info = socketIndex.get(socket.id);
		if (info) socketIndex.delete(socket.id);
	});
});

app.get("/", (_req, res) => res.send("Bingo Realtime Server OK"));
const PORT = Number(process.env.PORT || 4000);
server.listen(PORT, "0.0.0.0", async () => {
	try {
		await getRedis();
		console.log("✅ Redis connected");
	} catch (e) {
		console.error("❌ Redis connection failed", e);
	}
	console.log(`✅ Socket.IO server on :${PORT}`);
});
