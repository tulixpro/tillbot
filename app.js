
const express = require("express");
const app = express();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json());

app.get("/", (req, res) => {
  res.send("TILLBOT Server läuft!");
});

app.get("/api/status", (req, res) => {
  res.json({
    online: true,
    name: "TILLBOT",
    status: "Server läuft"
  });
});

app.post("/api/chat", (req, res) => {
  res.json({
    answer: "TILLBOT Server ist verbunden! Deine Nachricht: " + req.body.message
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("TILLBOT läuft auf Port " + PORT);
});

