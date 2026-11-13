
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

app.post("/api/chat", async (req, res) => {
  try {
    if (!process.env.HF_TOKEN) {
      return res.status(500).json({
        answer: "HF_TOKEN fehlt bei Render!"
      });
    }

    const history = Array.isArray(req.body.history)
      ? req.body.history
      : [];

    const messages = [
      {
        role: "system",
        content: "Du bist TILLBOT, ein freundlicher KI-Assistent. Antworte auf Deutsch, verständlich und hilfreich."
      },
      ...history
        .filter(m =>
          ["user", "assistant"].includes(m.role)
        )
        .map(m => ({
          role: m.role,
          content: String(m.content)
        }))
    ];

    const response = await fetch(
      "https://router.huggingface.co/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.HF_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b:fastest",
          messages,
          max_tokens: 300,
          temperature: 0.7
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Hugging Face Fehler:", response.status, data);

      return res.status(502).json({
        answer: "KI-Fehler: " +
          (data.error?.message || data.error || response.status)
      });
    }

    const answer =
      data.choices?.[0]?.message?.content ||
      "Die KI hat keine Antwort geliefert.";

    res.json({ answer });

  } catch (error) {
    console.error("Server Fehler:", error);

    res.status(500).json({
      answer: "Serverfehler: " + error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("TILLBOT läuft auf Port " + PORT);
});

