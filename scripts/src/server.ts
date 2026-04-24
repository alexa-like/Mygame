import express from "express";
import path from "path";

const app = express();

app.use(express.json());

// 🧠 serve frontend
app.use(express.static(path.join(process.cwd(), "public")));

// 🏠 homepage
app.get("/", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "public/index.html"));
});

// 🧪 API test route
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
