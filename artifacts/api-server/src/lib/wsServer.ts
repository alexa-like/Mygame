import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { db, messagesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { userByToken } from "./auth";

interface Client {
  ws: WebSocket;
  userId: string;
  username: string;
}

const clients = new Map<string, Set<Client>>(); // userId -> Set of clients (multi-tab)

function send(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function broadcastAll(data: unknown) {
  for (const set of clients.values()) {
    for (const c of set) send(c.ws, data);
  }
}

function sendToUser(userId: string, data: unknown) {
  const set = clients.get(userId);
  if (!set) return false;
  for (const c of set) send(c.ws, data);
  return true;
}

function onlineUserIds(): string[] {
  return [...clients.keys()];
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/api/ws" });

  wss.on("connection", (ws) => {
    let client: Client | null = null;

    const sendOnline = () => broadcastAll({ kind: "online", userIds: onlineUserIds() });

    ws.on("message", async (raw) => {
      let parsed: unknown;
      try { parsed = JSON.parse(raw.toString()); } catch { return; }
      if (!parsed || typeof parsed !== "object") return;
      const msg = parsed as Record<string, unknown>;

      if (msg.kind === "auth") {
        const user = await userByToken(String(msg.token || ""));
        if (!user) { send(ws, { kind: "error", error: "Invalid token" }); ws.close(); return; }
        client = { ws, userId: user.id, username: user.username };
        let set = clients.get(user.id);
        if (!set) { set = new Set(); clients.set(user.id, set); }
        set.add(client);
        send(ws, { kind: "auth_ok", userId: user.id, username: user.username });
        sendOnline();
        return;
      }

      if (!client) return;

      if (msg.kind === "world_msg") {
        const content = String(msg.content || "").trim().slice(0, 500);
        if (!content) return;
        const inserted = await db.insert(messagesTable).values({
          fromUserId: client.userId,
          toUserId: null,
          content,
        }).returning();
        const m = inserted[0]!;
        broadcastAll({
          kind: "world_msg",
          message: {
            id: m.id,
            content: m.content,
            createdAt: m.createdAt,
            fromUserId: client.userId,
            fromUsername: client.username,
          },
        });
        return;
      }

      if (msg.kind === "private_msg") {
        const toUserId = String(msg.toUserId || "");
        const content = String(msg.content || "").trim().slice(0, 500);
        if (!content || !toUserId) return;
        const recipient = await db.select().from(usersTable).where(eq(usersTable.id, toUserId)).limit(1);
        if (!recipient[0]) { send(ws, { kind: "error", error: "Recipient not found" }); return; }
        const inserted = await db.insert(messagesTable).values({
          fromUserId: client.userId,
          toUserId,
          content,
        }).returning();
        const m = inserted[0]!;
        const payload = {
          kind: "private_msg",
          message: {
            id: m.id,
            content: m.content,
            createdAt: m.createdAt,
            fromUserId: client.userId,
            toUserId,
            fromUsername: client.username,
          },
        };
        send(ws, payload);
        sendToUser(toUserId, payload);
        return;
      }
    });

    ws.on("close", () => {
      if (!client) return;
      const set = clients.get(client.userId);
      if (set) {
        set.delete(client);
        if (set.size === 0) clients.delete(client.userId);
      }
      broadcastAll({ kind: "online", userIds: onlineUserIds() });
    });

    ws.on("error", (err) => logger.warn({ err }, "ws error"));
  });

  logger.info("WebSocket server attached at /api/ws");
}
