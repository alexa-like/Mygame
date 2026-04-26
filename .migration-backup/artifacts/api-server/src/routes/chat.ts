import { Router, type IRouter } from "express";
import { db, messagesTable, usersTable } from "@workspace/db";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { authMiddleware, type AuthedRequest } from "../lib/auth";

const router: IRouter = Router();

router.get("/chat/world", authMiddleware, async (_req, res) => {
  const rows = await db
    .select({
      id: messagesTable.id,
      content: messagesTable.content,
      createdAt: messagesTable.createdAt,
      fromUserId: messagesTable.fromUserId,
      fromUsername: usersTable.username,
    })
    .from(messagesTable)
    .leftJoin(usersTable, eq(usersTable.id, messagesTable.fromUserId))
    .where(isNull(messagesTable.toUserId))
    .orderBy(desc(messagesTable.createdAt))
    .limit(80);
  res.json({ messages: rows.reverse() });
});

router.get("/chat/private/:userId", authMiddleware, async (req: AuthedRequest, res) => {
  const me = req.user!.id;
  const other = req.params.userId!;
  const rows = await db
    .select({
      id: messagesTable.id,
      content: messagesTable.content,
      createdAt: messagesTable.createdAt,
      fromUserId: messagesTable.fromUserId,
      toUserId: messagesTable.toUserId,
      fromUsername: usersTable.username,
    })
    .from(messagesTable)
    .leftJoin(usersTable, eq(usersTable.id, messagesTable.fromUserId))
    .where(
      or(
        and(eq(messagesTable.fromUserId, me), eq(messagesTable.toUserId, other)),
        and(eq(messagesTable.fromUserId, other), eq(messagesTable.toUserId, me)),
      ),
    )
    .orderBy(desc(messagesTable.createdAt))
    .limit(80);
  res.json({ messages: rows.reverse() });
});

export default router;
