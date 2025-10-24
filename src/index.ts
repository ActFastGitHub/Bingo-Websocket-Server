import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { z } from "zod";
import { RoomState, Player, BingoWinner, RoundWinner } from "./types";
import { makeCard, makeDeck } from "./game";
import { PatternType, hasPattern } from "./patterns";

const norm = (s: string) => s.trim().toUpperCase();
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const app = express();

// ⚠️ Put your real Vercel URL below
const allowedOrigins = [
  "http://localhost:3000",
  "https://YOUR-VERCEL-APP.vercel.app",
];

app.use(cors({ origin: allowedOrigins, methods: ["GET", "POST"] }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
  transports: ["websocket"],
});

// In-memory rooms
const rooms = new Map<string, RoomState>();

// Track which socket belongs to which { code, clientId }
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
    if (!seen.has(key)) {
      seen.add(key);
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
    calledCount: room.called.length,
    last: room.called[room.called.length - 1] ?? null,
    players: Array.from(room.players.values()).map((p) => ({ id: p.clientId, name: p.name, cards: p.cards.length })),
    roundId: room.roundId,
    winners: room.winners,
    pattern: room.pattern,
    allowAutoMark: room.allowAutoMark,
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
  // 👀 NEW: let non-joined clients subscribe to updates (join screen)
  socket.on("room:watch", (code: string, cb: (res: { ok: boolean; summary?: any; msg?: string }) => void) => {
    code = norm(code);
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, msg: "Room not found" });
    socket.join(code);                     // subscribe to room broadcasts
    cb({ ok: true, summary: summarize(room) }); // send current settings
  });

  // HOST: create room
  socket.on("host:create_room", (_: unknown, cb: (payload: { code: string; seed: number }) => void) => {
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
      roundId: 0,
      winners: [],
    };
    rooms.set(code, room);
    socket.join(code);
    cb({ code, seed });
    io.to(code).emit("room:updated", summarize(room));
  });

  // HOST: set winning pattern
  socket.on("host:set_pattern", (payload: { code: string; pattern: PatternType }) => {
    const code = norm(payload.code);
    const room = rooms.get(code);
    if (!room) return;
    room.pattern = payload.pattern;
    io.to(code).emit("room:updated", summarize(room));
  });

  // HOST: allow/disallow auto-mark
  socket.on("host:set_allow_automark", (payload: { code: string; allow: boolean }) => {
    const code = norm(payload.code);
    const room = rooms.get(code);
    if (!room) return;
    room.allowAutoMark = !!payload.allow;
    if (!room.allowAutoMark) {
      for (const p of room.players.values()) {
        p.autoMark = false;
        p.manual = true;
      }
    }
    io.to(code).emit("room:updated", summarize(room));
  });

  // HOST: start round
  socket.on("host:start", (code: string) => {
    code = norm(code);
    const room = rooms.get(code);
    if (!room) return;
    room.started = true;
    room.called = [];
    room.deck = makeDeck(room.seed);
    room.roundId += 1;
    room.winners = [];
    for (const p of room.players.values()) {
      p.marks = p.cards.map(() => []);
      p.lastClaimAt = 0;
    }
    io.to(code).emit("game:started", { code, roundId: room.roundId });
    io.to(code).emit("room:updated", summarize(room));
  });

  // HOST: call next number
  socket.on("host:call_next", (code: string) => {
    code = norm(code);
    const room = rooms.get(code);
    if (!room || !room.started) return;
    const next = room.deck.shift();
    if (!next) return;
    room.called.push(next);
    io.to(code).emit("game:called", { n: next, history: room.called, roundId: room.roundId });
  });

  // HOST: undo last
  socket.on("host:undo", (code: string) => {
    code = norm(code);
    const room = rooms.get(code);
    if (!room || !room.started || room.called.length === 0) return;
    const last = room.called.pop()!;
    room.deck.unshift(last);
    io.to(code).emit("game:undo", { history: room.called, roundId: room.roundId });
  });

  // PLAYER: join (reconnect + multi-cards)
  socket.on("player:join", (payload, cb) => {
    const parsed = JoinSchema.safeParse(payload);
    if (!parsed.success) return cb({ ok: false, msg: "Invalid join data" });

    const code = norm(parsed.data.code);
    const clientId = parsed.data.clientId.trim();
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, msg: "Room not found" });

    socket.join(code);
    socket.join(clientId);
    socketIndex.set(socket.id, { code, clientId });

    let player = room.players.get(clientId);
    if (player) {
      player.name = parsed.data.name || player.name;
      player.lastSocketId = socket.id;
      return cb({
        ok: true,
        cards: player.cards,
        roundId: room.roundId,
        allowAutoMark: room.allowAutoMark,
        activeCard: player.activeCard,
      });
    }

    const count = clamp(parsed.data.cardCount ?? 1, 1, 4);
    const cards: number[][][] = [];
    for (let i = 0; i < count; i++) {
      const salt = hashStr(`${clientId}#${i}`);
      cards.push(makeCard(room.seed, salt));
    }

    const useAuto = room.allowAutoMark ? (parsed.data.autoMark ?? true) : false;
    const useManual = room.allowAutoMark ? (parsed.data.manual ?? !useAuto) : true;
    const incomingMarks = parsed.data.marks ?? [];
    const marks = cards.map((_, i) => sanitizeMarks(incomingMarks[i] ?? []));

    player = {
      clientId,
      name: parsed.data.name,
      cards,
      activeCard: 0,
      autoMark: useAuto,
      manual: useManual,
      marks,
      lastClaimAt: 0,
      lastSocketId: socket.id,
    };
    room.players.set(clientId, player);

    cb({
      ok: true,
      cards: player.cards,
      roundId: room.roundId,
      allowAutoMark: room.allowAutoMark,
      activeCard: player.activeCard,
    });
    io.to(code).emit("room:updated", summarize(room));
  });

  // PLAYER: switch active card
  socket.on("player:switch_card", (code: string, clientId: string, cardIndex: number) => {
    code = norm(code);
    const room = rooms.get(code);
    if (!room) return;
    const p = room.players.get(clientId);
    if (!p) return;
    const idx = clamp(cardIndex, 0, p.cards.length - 1);
    p.activeCard = idx;
    io.to(clientId).emit("player:active_card", idx);
  });

  // PLAYER: update marks for one card (manual mode)
  socket.on("player:update_marks", (code: string, clientId: string, cardIndex: number, marks: [number, number][]) => {
    code = norm(code);
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.get(clientId);
    if (!player) return;
    if (!player.manual) return;
    const idx = clamp(cardIndex, 0, player.cards.length - 1);
    player.marks[idx] = sanitizeMarks(marks);
  });

  // PLAYER: claim bingo on a specific card
  socket.on("player:claim_bingo", (code: string, clientId: string, cardIndex: number, cb: (res: { ok: boolean; msg?: string }) => void) => {
    code = norm(code);
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, msg: "Room not found" });

    const player = room.players.get(clientId);
    if (!player) return cb({ ok: false, msg: "Player not in room" });

    // Cooldown 2s
    const now = Date.now();
    if (player.lastClaimAt && now - player.lastClaimAt < 2000) {
      return cb({ ok: false, msg: "Please wait a moment before claiming again" });
    }
    player.lastClaimAt = now;

    const idx = clamp(cardIndex, 0, player.cards.length - 1);
    const card = player.cards[idx];
    const calledSet = new Set(room.called);

    // If manual, keep only correct marks (FREE or called)
    if (player.manual) {
      const before = player.marks[idx].length;
      player.marks[idx] = player.marks[idx].filter(([r, c]) => {
        const v = card?.[r]?.[c];
        return v === 0 || calledSet.has(v);
      });
      if (player.marks[idx].length !== before) {
        io.to(player.lastSocketId || "").emit("player:marks_corrected", { cardIndex: idx, marks: player.marks[idx] });
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
      const wBrief: RoundWinner = { playerId: winner.playerId, name: winner.name, pattern: winner.pattern, at: winner.at, cardIndex: idx };
      room.winners.push(wBrief);
      io.to(code).emit("game:winner", winner);
      io.to(code).emit("room:winners", room.winners);
      io.to(code).emit("room:updated", summarize(room));
    }

    cb({ ok: true });
  });

  // We keep players in memory on disconnect (reconnect-friendly)
  socket.on("disconnecting", () => {
    const info = socketIndex.get(socket.id);
    if (info) socketIndex.delete(socket.id);
  });
});

app.get("/", (_req, res) => res.send("Bingo Realtime Server OK"));
const PORT = Number(process.env.PORT || 4000);
server.listen(PORT, "0.0.0.0", () => console.log(`✅ Socket.IO server on :${PORT}`));
