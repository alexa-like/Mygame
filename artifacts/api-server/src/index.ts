import http from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { setupWebSocket } from "./lib/wsServer";
import { ensureDevAccount, sweepPendingDeletes } from "./lib/seed";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);
setupWebSocket(server);

server.listen(port, async () => {
  logger.info({ port }, "Server listening (HTTP + WebSocket)");
  try {
    await ensureDevAccount();
  } catch (err) {
    logger.error({ err }, "Failed to seed dev account");
  }
  // Sweep pending self-deletes every 5 minutes.
  setInterval(() => {
    sweepPendingDeletes().catch((err) => logger.error({ err }, "Sweep failed"));
  }, 5 * 60 * 1000);
});
