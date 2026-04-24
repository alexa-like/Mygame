console.log("BOOT START");

import express from "express";

console.log("EXPRESS IMPORT OK");

const app = express();

console.log("APP CREATED");

app.listen(3000, () => {
  console.log("SERVER STARTED");
});
