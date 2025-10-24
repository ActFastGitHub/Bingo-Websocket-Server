import type { Request, Response, NextFunction } from "express";
import { listRoomCodes, loadRoom, deleteAllRooms, deleteRoom } from "./store";

function getToken(req: Request): string | undefined {
  const h = req.get("authorization") || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  return (req.query.token as string) || undefined;
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = getToken(req);
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return res.status(500).send("ADMIN_TOKEN not configured on the server");
  if (token !== expected) return res.status(401).send("Unauthorized");
  return next();
}

export function mountAdmin(app: any) {
  app.get("/admin/rooms", requireAdmin, async (_req: Request, res: Response) => {
    const codes = await listRoomCodes();
    const items: Array<{ code: string; players: number; called: number; started: boolean; roundId: number; locked: boolean; pattern: string }> = [];
    for (const code of codes) {
      const room = await loadRoom(code);
      if (!room) continue;
      items.push({
        code,
        players: room.players.size,
        called: room.called.length,
        started: room.started,
        roundId: room.roundId,
        locked: room.locked,
        pattern: room.pattern,
      });
    }
    res.json({ rooms: items });
  });

  app.post("/admin/rooms/clear", requireAdmin, async (_req: Request, res: Response) => {
    const n = await deleteAllRooms();
    res.json({ ok: true, deleted: n });
  });

  app.post("/admin/room/:code/delete", requireAdmin, async (req: Request, res: Response) => {
    const code = String(req.params.code || "").toUpperCase();
    await deleteRoom(code);
    res.json({ ok: true, code });
  });

  app.get("/admin", requireAdmin, async (req: Request, res: Response) => {
    const token = getToken(req);
    const origin = `${req.protocol}://${req.get("host")}`;
    res.set("Content-Security-Policy", "default-src 'self' 'unsafe-inline'");
    res.type("html").send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Bingo Admin</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; padding: 24px; }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; }
    th, td { border: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; }
    th { background: #f8fafc; } .btn { padding: 6px 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: white; cursor: pointer; }
    .btn-red { background: #fee2e2; border-color: #fecaca; } .muted { color: #64748b; font-size: 12px; }
  </style>
</head>
<body>
  <h1>Bingo Admin</h1>
  <div class="muted">You are connected to: <code>${origin}</code></div>

  <div style="margin-top: 16px; display:flex; gap: 8px;">
    <button class="btn" id="refresh">Refresh</button>
    <button class="btn btn-red" id="clear-all">Clear All Rooms</button>
  </div>

  <div id="out" style="margin-top: 16px;"></div>

  <script>
    const token = ${JSON.stringify(token)};
    const out = document.getElementById('out');

    async function fetchRooms() {
      out.textContent = 'Loading...';
      const res = await fetch('/admin/rooms?token=' + encodeURIComponent(token));
      if (!res.ok) { out.textContent = 'Failed to load rooms'; return; }
      const data = await res.json();
      renderTable(data.rooms || []);
    }

    async function clearAll() {
      if (!confirm('Delete ALL rooms?')) return;
      const res = await fetch('/admin/rooms/clear?token=' + encodeURIComponent(token), { method: 'POST' });
      if (!res.ok) { alert('Failed'); return; }
      await fetchRooms();
    }

    async function deleteOne(code) {
      if (!confirm('Delete room ' + code + '?')) return;
      const res = await fetch('/admin/room/' + code + '/delete?token=' + encodeURIComponent(token), { method: 'POST' });
      if (!res.ok) { alert('Failed'); return; }
      await fetchRooms();
    }

    function renderTable(rooms) {
      if (!rooms.length) { out.innerHTML = '<p class="muted">No rooms.</p>'; return; }
      let html = '<table><thead><tr><th>Code</th><th>Players</th><th>Called</th><th>Pattern</th><th>Round</th><th>Started</th><th>Locked</th><th>Actions</th></tr></thead><tbody>';
      for (const r of rooms) {
        html += '<tr>' +
          '<td><code>' + r.code + '</code></td>' +
          '<td>' + r.players + '</td>' +
          '<td>' + r.called + '</td>' +
          '<td>' + r.pattern + '</td>' +
          '<td>' + r.roundId + '</td>' +
          '<td>' + (r.started ? 'yes' : 'no') + '</td>' +
          '<td>' + (r.locked ? 'yes' : 'no') + '</td>' +
          '<td><button class="btn btn-red" onclick="deleteOne(\\'' + r.code + '\\')">Delete</button></td>' +
        '</tr>';
      }
      html += '</tbody></table>';
      out.innerHTML = html;
    }

    document.getElementById('refresh').addEventListener('click', fetchRooms);
    document.getElementById('clear-all').addEventListener('click', clearAll);
    fetchRooms();
  </script>
</body>
</html>`);
  });
}
