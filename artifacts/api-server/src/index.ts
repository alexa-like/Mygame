import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import http from "http";
import { WebSocketServer } from "ws";

const app = express();

// 🔥 Middleware
app.use(cors({
  origin: "*",
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// 🧠 Basic test route
app.get("/", (req, res) => {
  res.json({
    message: "🔥 API Server is running smoothly",
    status: "OK",
    time: new Date().toISOString()
  });
});

// ❤️ Health check (Render uses this a lot)
app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});

// 🌍 Create HTTP server
const server = http.createServer(app);

// ⚡ WebSocket setup (for your game real-time features)
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("⚡ Player connected");

  ws.send(JSON.stringify({
    type: "welcome",
    message: "Welcome to game server 🎮🔥"
  }));

  ws.on("message", (msg) => {
    console.log("📩:", msg.toString());

    ws.send(JSON.stringify({
      type: "echo",
      data: msg.toString()
    }));
  });

  ws.on("close", () => {
    console.log("❌ Player disconnected");
  });
});

// 🚀 Start server
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
