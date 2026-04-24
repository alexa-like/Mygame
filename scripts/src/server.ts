import express from "express";

const app = express();

app.use(express.json());

// SAFE TEST ROUTE
app.get("/", (req, res) => {
  res.send("Server is alive 😎🔥");
});

// HEALTH CHECK
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
