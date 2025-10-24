import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { z } from "zod";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";

import { RoomState, Player, BingoWinner, RoundWinner } from "./types";
import { makeCard, makeDeck } from "./game";
import { PatternType, hasPattern } from "./patterns";
import { saveRoom, loadRoom } from "./store";
import { getRedis } from "./redis";
import { mountAdmin } from "./admin";

const norm = (s: string) => s.trim().toUpperCase();
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const app = express();

// ⚠️ Add your Vercel domain here
const allowedOrigins = [
  "http://localhost:3000",
  "https://YOUR-VERCEL-APP.vercel.app",
];

app.use(cors({ origin: allowedOrigins, methods: ["GET", "POST"] }));

// Admin routes
mountAdmin(app);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
});

// ----- Socket.IO Redis adapter -----
async function setupAdapter() {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn("REDIS_URL not set. Running without Socket.IO Redis adapter.");
    return;
  }
  const pubClient = createClient({ url });
  const subClient = pubClient.duplicate();

  pubClient.on("error", (e) => console.error("Redis pub error:", e));
  subClient.on("error", (e) => console.error("Redis sub error:", e));

  await pubClient.connect();
  await subClient.connect();
  io.adapter(createAdapter(pubClient, subClient));
  console.log("✅ Socket.IO Redis adapter enabled");
}
setupAdapter().catch((e) => console.error("Adapter setup failed:", e));

// ----- In-memory cache + Redis persistence -----
const rooms = new Map<string, RoomState>();

async function getRoom(code: string): Promise<RoomState | null> {
  const c = norm(code);
  let room = rooms.get(c);
  if (room) return room;
  const loaded = await loadRoom(c);
  if (loaded) {
    rooms.set(c, loaded);
    return loaded;
  }
  return null;
}
async function putRoom(room: RoomState): Promise<void> {
  rooms.set(room.code, room);
  await saveRoom(room);
}

// Socket index
const socketIndex = new Map<string, { code: string; clientId: string }>();

function genRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}
function randomSeed(): number { return Math.floor(Math.random() * 2 ** 31); }
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24); }
  return Math.abs(h >>> 0);
}

function sanitizeMarks(marks: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  const seen = new Set<string>();
  for (const [r, c] of marks) {
    if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
    if (r < 0 || r > 4 || c < 0 || c > 4) continue;
    const key = `${r}-${c}`;
    if (!seen.has(key)) { seen.add(key); out.push([r, c]); }
    if (out.length >= 25) break;
  }
  return out;
}

function summarize(room: RoomState) {
  return {
    code: room.code,
    started: room.started,
    calledCount: room.called.length,
    last: room.called[room.called.length - 1] ?? null,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.clientId, name: p.name, cards: p.cards.length,
    })),
    roundId: room.roundId,
    winners: room.winners,
    pattern: room.pattern,
    allowAutoMark: room.allowAutoMark,
    locked: room.locked,
    lockLobbyOnStart: room.lockLobbyOnStart,
  };
}

const JoinSchema = z.object({
  code: z.string().trim().min(6).max(6),
  name: z.string().trim().min(1).max(40),
  clientId: z.string().trim().min(8).max(64),
  cardCount: z.number().int().min(1).max(4).default(1),
  autoMark: z.boolean().optional(),
  manual: z.boolean().optional(),
  marks: z.array(z.array(z.tuple([z.number().int(), z.number().int()]))).optional(),
});

io.on("connection", (socket) => {
  socket.on("room:exists", async (code: string, cb: (res: { ok: boolean }) => void) => {
    const room = await getRoom(code);
    cb({ ok: !!room });
  });

  socket.on("room:watch", async (code: string, cb: (res: { ok: boolean; summary?: any; msg?: string }) => void) => {
    const room = await getRoom(code);
    if (!room) return cb({ ok: false, msg: "Room not found" });
    socket.join(room.code);
    cb({ ok: true, summary: summarize(room) });
  });

  socket.on("host:create_room", async (_: unknown, cb: (payload: { code: string; seed: number }) => void) => {
    const code = genRoomCode();
    const seed = randomSeed();
    const room: RoomState = {
      code, seed,
      deck: makeDeck(seed),
      called: [],
      players: new Map(),
      started: false,
      pattern: "line",
      allowAutoMark: true,
      lockLobbyOnStart: true,
      locked: false,
      roundId: 0,
      winners: [],
    };
    await putRoom(room);
    socket.join(code);
    cb({ code, seed });
    io.to(code).emit("room:updated", summarize(room));
  });

  socket.on("host:set_pattern", async (payload: { code: string; pattern: PatternType }) => {
    const room = await getRoom(payload.code);
    if (!room) return;
    room.pattern = payload.pattern;
    await putRoom(room);
    io.to(room.code).emit("room:updated", summarize(room));
  });

  socket.on("host:set_allow_automark", async (payload: { code: string; allow: boolean }) => {
    const room = await getRoom(payload.code);
    if (!room) return;
    room.allowAutoMark = !!payload.allow;

    if (!room.allowAutoMark) {
      for (const p of room.players.values()) {
        p.autoMark = false; p.manual = true;
        if (p.lastSocketId) io.to(p.lastSocketId).emit("policy:allow_automark", false);
      }
    } else {
      for (const p of room.players.values()) {
        if (p.lastSocketId) io.to(p.lastSocketId).emit("policy:allow_automark", true);
      }
    }

    await putRoom(room);
    io.to(room.code).emit("policy:allow_automark", room.allowAutoMark);
    io.to(room.code).emit("room:updated", summarize(room));
  });

  socket.on("host:set_lock_on_start", async (payload: { code: string; lockOnStart: boolean }) => {
    const room = await getRoom(payload.code);
    if (!room) return;
    room.lockLobbyOnStart = !!payload.lockOnStart;
    await putRoom(room);
    io.to(room.code).emit("room:updated", summarize(room));
  });

  socket.on("host:set_locked", async (payload: { code: string; locked: boolean }) => {
    const room = await getRoom(payload.code);
    if (!room) return;
    room.locked = !!payload.locked;
    await putRoom(room);
    io.to(room.code).emit("policy:locked", room.locked);
    io.to(room.code).emit("room:updated", summarize(room));
  });

  socket.on("host:start", async (code: string) => {
    const room = await getRoom(code);
    if (!room) return;

    room.started = true;
    room.called = [];
    room.deck = makeDeck(room.seed);
    room.roundId += 1;
    room.winners = [];

    if (room.lockLobbyOnStart) {
      room.locked = true;
      io.to(room.code).emit("policy:locked", true);
    }

    for (const p of room.players.values()) {
      p.marks = p.cards.map(() => []); p.lastClaimAt = 0;
    }
    await putRoom(room);
    io.to(room.code).emit("game:started", { code: room.code, roundId: room.roundId });
    io.to(room.code).emit("room:updated", summarize(room));
  });

  socket.on("host:call_next", async (code: string) => {
    const room = await getRoom(code);
    if (!room || !room.started) return;
    const next = room.deck.shift();
    if (!next) return;
    room.called.push(next);
    await putRoom(room);
    io.to(room.code).emit("game:called", { n: next, history: room.called, roundId: room.roundId });
  });

  socket.on("host:undo", async (code: string) => {
    const room = await getRoom(code);
    if (!room || !room.started || room.called.length === 0) return;
    const last = room.called.pop()!;
    room.deck.unshift(last);
    await putRoom(room);
    io.to(room.code).emit("game:undo", { history: room.called, roundId: room.roundId });
  });

  socket.on("player:join", async (payload, cb) => {
    const parsed = z.object({
      code: z.string().trim().min(6).max(6),
      name: z.string().trim().min(1).max(40),
      clientId: z.string().trim().min(8).max(64),
      cardCount: z.number().int().min(1).max(4).default(1),
      autoMark: z.boolean().optional(),
      manual: z.boolean().optional(),
      marks: z.array(z.array(z.tuple([z.number().int(), z.number().int()]))).optional(),
    }).safeParse(payload);
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
        name: player.name,
      });
    }

    const count = clamp(parsed.data.cardCount ?? 1, 1, 4);
    const cards: number[][][] = [];
    for (let i = 0; i < count; i++) {
      const salt = hashStr(`${parsed.data.clientId}#${i}`);
      cards.push(makeCard(room.seed, salt));
    }

    const useAuto = room.allowAutoMark ? (parsed.data.autoMark ?? true) : false;
    const useManual = room.allowAutoMark ? (parsed.data.manual ?? !useAuto) : true;
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
      lastSocketId: socket.id,
    };
    room.players.set(player.clientId, player);

    await putRoom(room);
    cb({
      ok: true,
      cards: player.cards,
      roundId: room.roundId,
      allowAutoMark: room.allowAutoMark,
      activeCard: player.activeCard,
      name: player.name,
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

  socket.on("player:update_marks", async (code: string, clientId: string, cardIndex: number, marks: [number, number][]) => {
    const room = await getRoom(code);
    if (!room) return;
    const p = room.players.get(clientId);
    if (!p || !p.manual) return;
    const idx = clamp(cardIndex, 0, p.cards.length - 1);
    p.marks[idx] = sanitizeMarks(marks);
    await putRoom(room);
  });

  socket.on("player:claim_bingo", async (code: string, clientId: string, cardIndex: number, cb: (res: { ok: boolean; msg?: string }) => void) => {
    const room = await getRoom(code);
    if (!room) return cb({ ok: false, msg: "Room not found" });

    const player = room.players.get(clientId);
    if (!player) return cb({ ok: false, msg: "Player not in room" });

    const now = Date.now();
    if (player.lastClaimAt && now - player.lastClaimAt < 2000) return cb({ ok: false, msg: "Please wait before claiming again" });
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
      if (player.marks[idx].length !== before && player.lastSocketId) {
        io.to(player.lastSocketId).emit("player:marks_corrected", { cardIndex: idx, marks: player.marks[idx] });
      }
    }

    const valid = hasPattern(card, calledSet, room.pattern);
    if (!valid) return cb({ ok: false, msg: "Pattern not satisfied yet" });

    if (!room.winners.some(w => w.playerId === player.clientId)) {
      const winner: BingoWinner = {
        playerId: player.clientId,
        name: player.name,
        cardIndex: idx,
        pattern: room.pattern,
        proofCard: card,
        at: room.called.length,
        roundId: room.roundId,
      };
      const brief: RoundWinner = { playerId: winner.playerId, name: winner.name, pattern: winner.pattern, at: winner.at, cardIndex: idx };
      room.winners.push(brief);
      await putRoom(room);
      io.to(room.code).emit("game:winner", winner);
      io.to(room.code).emit("room:winners", room.winners);
      io.to(room.code).emit("room:updated", summarize(room));
    } else {
      await putRoom(room);
    }

    cb({ ok: true });
  });

  socket.on("disconnecting", () => {
    const info = socketIndex.get(socket.id);
    if (info) socketIndex.delete(socket.id);
  });
});

app.get("/", (_req, res) => res.send("Bingo Realtime Server OK"));
const PORT = Number(process.env.PORT || 4000);
server.listen(PORT, "0.0.0.0", async () => {
  try { await getRedis(); console.log("✅ Redis connected"); }
  catch (e) { console.error("❌ Redis connection failed", e); }
  console.log(`✅ Socket.IO server on :${PORT}`);
});
