import express from "express";

const app = express();

app.use(express.json());

// ROOT TEST
app.get("/", (_req, res) => {
  res.send("Server is working 😎🔥");
});

// HEALTH CHECK
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
