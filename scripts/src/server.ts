import express from "express";

const app = express();

app.use(express.json());

// ROOT ROUTE
app.get("/", (_req, res) => {
  res.send("Server is alive 😎🔥");
});

// TEST ROUTE
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
