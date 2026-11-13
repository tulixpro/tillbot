const express = require("express");
const app = express();

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
    answer: "TILLBOT Server ist verbunden!"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("TILLBOT läuft auf Port " + PORT);
});
