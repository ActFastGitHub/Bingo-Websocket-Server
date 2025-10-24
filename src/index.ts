// import express from "express";
// import http from "http";
// import cors from "cors";
// import { Server } from "socket.io";
// import { z } from "zod";
// import { RoomState, Player, BingoWinner, RoundWinner } from "./types";
// import { makeCard, makeDeck, hasLineBingo } from "./game";

// const app = express();
// app.use(cors());
// const server = http.createServer(app);

// const io = new Server(server, { cors: { origin: "*" } });

// // In-memory rooms
// const rooms = new Map<string, RoomState>();

// function genRoomCode(): string {
//   const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
//   let code = "";
//   for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
//   return code;
// }
// function randomSeed(): number { return Math.floor(Math.random() * 2 ** 31); }

// function summarize(room: RoomState) {
//   return {
//     code: room.code,
//     started: room.started,
//     calledCount: room.called.length,
//     last: room.called[room.called.length - 1] ?? null,
//     players: Array.from(room.players.values()).map((p) => ({ id: p.id, name: p.name })),
//     roundId: room.roundId,
//     winners: room.winners, // expose winners
//   };
// }
// function hashStr(s: string): number {
//   let h = 2166136261;
//   for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24); }
//   return Math.abs(h >>> 0);
// }
// const JoinSchema = z.object({ code: z.string().trim().min(6).max(6), name: z.string().trim().min(1).max(40) });

// io.on("connection", (socket) => {
//   // HOST: create room
//   socket.on("host:create_room", (_: unknown, cb: (payload: { code: string; seed: number }) => void) => {
//     const code = genRoomCode();
//     const seed = randomSeed();
//     const room: RoomState = {
//       code, seed,
//       deck: makeDeck(seed),
//       called: [],
//       players: new Map(),
//       started: false,
//       pattern: "line",
//       roundId: 0,
//       winners: [],
//     };
//     rooms.set(code, room);
//     socket.join(code);
//     cb({ code, seed });
//     io.to(code).emit("room:updated", summarize(room));
//   });

//   // HOST: start round
//   socket.on("host:start", (code: string) => {
//     const room = rooms.get(code);
//     if (!room) return;
//     room.started = true;
//     room.called = [];
//     room.deck = makeDeck(room.seed);
//     room.roundId += 1;
//     room.winners = [];
//     io.to(code).emit("game:started", { code, roundId: room.roundId });
//     io.to(code).emit("room:updated", summarize(room));
//   });

//   // HOST: call next number
//   socket.on("host:call_next", (code: string) => {
//     const room = rooms.get(code);
//     if (!room || !room.started) return;
//     const next = room.deck.shift();
//     if (!next) return;
//     room.called.push(next);
//     io.to(code).emit("game:called", { n: next, history: room.called, roundId: room.roundId });
//   });

//   // HOST: undo last
//   socket.on("host:undo", (code: string) => {
//     const room = rooms.get(code);
//     if (!room || !room.started || room.called.length === 0) return;
//     const last = room.called.pop()!;
//     room.deck.unshift(last);
//     io.to(code).emit("game:undo", { history: room.called, roundId: room.roundId });
//   });

//   // PLAYER: join
//   socket.on("player:join", (payload: { code: string; name: string }, cb: (res: { ok: boolean; msg?: string; card?: number[][]; roundId?: number }) => void) => {
//     const parsed = JoinSchema.safeParse(payload);
//     if (!parsed.success) return cb({ ok: false, msg: "Invalid join data" });
//     const { code, name } = parsed.data;
//     const room = rooms.get(code);
//     if (!room) return cb({ ok: false, msg: "Room not found" });

//     socket.join(code);
//     const salt = hashStr(socket.id);
//     const card = makeCard(room.seed, salt);
//     const player: Player = { id: socket.id, name, card };
//     room.players.set(socket.id, player);

//     cb({ ok: true, card, roundId: room.roundId });
//     io.to(code).emit("room:updated", summarize(room));
//   });

//   // PLAYER: claim bingo
//   socket.on("player:claim_bingo", (code: string, cb: (res: { ok: boolean; msg?: string }) => void) => {
//     const room = rooms.get(code);
//     if (!room) return cb({ ok: false, msg: "Room not found" });
//     const player = room.players.get(socket.id);
//     if (!player) return cb({ ok: false, msg: "Player not in room" });

//     const calledSet = new Set(room.called);
//     const valid = hasLineBingo(player.card, calledSet);
//     if (!valid) return cb({ ok: false, msg: "No valid line yet" });

//     // Prevent duplicate winner entries for same player within round
//     if (!room.winners.some(w => w.playerId === player.id)) {
//       const winner: BingoWinner = {
//         playerId: player.id,
//         name: player.name,
//         pattern: room.pattern,
//         proofCard: player.card,
//         at: room.called.length,
//         roundId: room.roundId,
//       };
//       const wBrief: RoundWinner = { playerId: winner.playerId, name: winner.name, pattern: winner.pattern, at: winner.at };
//       room.winners.push(wBrief);
//       io.to(code).emit("game:winner", winner);          // detailed, for toast / UI pop
//       io.to(code).emit("room:winners", room.winners);   // running list for UI
//       io.to(code).emit("room:updated", summarize(room));
//     }
//     cb({ ok: true });
//   });

//   // Cleanup on disconnect
//   socket.on("disconnecting", () => {
//     for (const code of socket.rooms) {
//       const room = rooms.get(code);
//       if (!room) continue;
//       if (room.players.delete(socket.id)) {
//         io.to(code).emit("room:updated", summarize(room));
//       }
//     }
//   });
// });

// app.get("/", (_req, res) => res.send("Bingo Realtime Server OK"));
// const PORT = process.env.PORT || 4000;
// server.listen(PORT, () => console.log(`Socket.IO server listening on http://localhost:${PORT}`));

import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { z } from "zod";
import { RoomState, Player, BingoWinner, RoundWinner } from "./types";
import { makeCard, makeDeck, hasLineBingo } from "./game";

/* ----------------- Server Setup ----------------- */
const app = express();

// Update these to your real frontend domains
const allowedOrigins = [
  "http://localhost:3000",                // local dev
  "https://YOUR-VERCEL-APP.vercel.app",   // production client (replace this)
];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  })
);

const server = http.createServer(app);

// Socket.IO with secure CORS and WebSocket transport
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
  transports: ["websocket"],
});

/* ----------------- In-Memory Game State ----------------- */
const rooms = new Map<string, RoomState>();

function genRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}
function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return Math.abs(h >>> 0);
}
function summarize(room: RoomState) {
  return {
    code: room.code,
    started: room.started,
    calledCount: room.called.length,
    last: room.called[room.called.length - 1] ?? null,
    players: Array.from(room.players.values()).map((p) => ({ id: p.id, name: p.name })),
    roundId: room.roundId,
    winners: room.winners,
  };
}

const JoinSchema = z.object({
  code: z.string().trim().min(6).max(6),
  name: z.string().trim().min(1).max(40),
});

/* ----------------- Socket.IO Events ----------------- */
io.on("connection", (socket) => {
  /* --- Host: Create Room --- */
  socket.on("host:create_room", (_: unknown, cb: (payload: { code: string; seed: number }) => void) => {
    const code = genRoomCode();
    const seed = randomSeed();
    const room: RoomState = {
      code,
      seed,
      deck: makeDeck(seed),
      called: [],
      players: new Map(),
      started: false,
      pattern: "line",
      roundId: 0,
      winners: [],
    };
    rooms.set(code, room);
    socket.join(code);
    cb({ code, seed });
    io.to(code).emit("room:updated", summarize(room));
  });

  /* --- Host: Start Round --- */
  socket.on("host:start", (code: string) => {
    const room = rooms.get(code);
    if (!room) return;
    room.started = true;
    room.called = [];
    room.deck = makeDeck(room.seed);
    room.roundId += 1;
    room.winners = [];
    io.to(code).emit("game:started", { code, roundId: room.roundId });
    io.to(code).emit("room:updated", summarize(room));
  });

  /* --- Host: Call Next Number --- */
  socket.on("host:call_next", (code: string) => {
    const room = rooms.get(code);
    if (!room || !room.started) return;
    const next = room.deck.shift();
    if (!next) return;
    room.called.push(next);
    io.to(code).emit("game:called", { n: next, history: room.called, roundId: room.roundId });
  });

  /* --- Host: Undo --- */
  socket.on("host:undo", (code: string) => {
    const room = rooms.get(code);
    if (!room || !room.started || room.called.length === 0) return;
    const last = room.called.pop()!;
    room.deck.unshift(last);
    io.to(code).emit("game:undo", { history: room.called, roundId: room.roundId });
  });

  /* --- Player: Join --- */
  socket.on(
    "player:join",
    (payload: { code: string; name: string }, cb: (res: { ok: boolean; msg?: string; card?: number[][]; roundId?: number }) => void) => {
      const parsed = JoinSchema.safeParse(payload);
      if (!parsed.success) return cb({ ok: false, msg: "Invalid join data" });
      const { code, name } = parsed.data;
      const room = rooms.get(code);
      if (!room) return cb({ ok: false, msg: "Room not found" });

      socket.join(code);
      const salt = hashStr(socket.id);
      const card = makeCard(room.seed, salt);
      const player: Player = { id: socket.id, name, card };
      room.players.set(socket.id, player);

      cb({ ok: true, card, roundId: room.roundId });
      io.to(code).emit("room:updated", summarize(room));
    }
  );

  /* --- Player: Claim Bingo --- */
  socket.on("player:claim_bingo", (code: string, cb: (res: { ok: boolean; msg?: string }) => void) => {
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, msg: "Room not found" });
    const player = room.players.get(socket.id);
    if (!player) return cb({ ok: false, msg: "Player not in room" });

    const calledSet = new Set(room.called);
    const valid = hasLineBingo(player.card, calledSet);
    if (!valid) return cb({ ok: false, msg: "No valid line yet" });

    if (!room.winners.some((w) => w.playerId === player.id)) {
      const winner: BingoWinner = {
        playerId: player.id,
        name: player.name,
        pattern: room.pattern,
        proofCard: player.card,
        at: room.called.length,
        roundId: room.roundId,
      };
      const wBrief: RoundWinner = { playerId: winner.playerId, name: winner.name, pattern: winner.pattern, at: winner.at };
      room.winners.push(wBrief);

      io.to(code).emit("game:winner", winner);
      io.to(code).emit("room:winners", room.winners);
      io.to(code).emit("room:updated", summarize(room));
    }
    cb({ ok: true });
  });

  /* --- Disconnect Cleanup --- */
  socket.on("disconnecting", () => {
    for (const code of socket.rooms) {
      const room = rooms.get(code);
      if (!room) continue;
      if (room.players.delete(socket.id)) {
        io.to(code).emit("room:updated", summarize(room));
      }
    }
  });
});

/* ----------------- Express Health Route ----------------- */
app.get("/", (_req, res) => res.send("Bingo Realtime Server OK"));

/* ----------------- Start Server ----------------- */
const PORT = Number(process.env.PORT || 4000);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Socket.IO server running on port ${PORT}`);
});


