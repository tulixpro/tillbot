
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
    status: "KI-Server läuft"
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        answer: "GROQ_API_KEY fehlt bei Render."
      });
    }

    const history = Array.isArray(req.body.history)
      ? req.body.history
      : [];

    const messages = [
      {
        role: "system",
        content: `Du bist TILLBOT, ein moderner, freundlicher und intelligenter KI-Assistent.
Antworte auf Deutsch, wenn der Benutzer Deutsch schreibt.
Erkläre verständlich, hilfreich und ausführlich genug.
Sei ehrlich, wenn du etwas nicht weißt.
Verwende den Gesprächsverlauf für passende Antworten.`
      },
      ...history
        .filter(m =>
          ["user", "assistant"].includes(m.role)
        && typeof m.content === "string"
        && m.content.trim()
        && m.content.length < 20000
        )
        .slice(-20)
        .map(m => ({
          role: m.role,
          content: m.content
        }))
    ];

    if (messages.length === 1 && req.body.message) {
      messages.push({
        role: "user",
        content: String(req.body.message)
      });
    }

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages,
          max_completion_tokens: 1024,
          temperature: 0.7
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Groq Fehler:", response.status, data);

      return res.status(502).json({
        answer: "Groq KI Fehler: " +
          (data.error?.message || response.status)
      });
    }

    const answer = data.choices?.[0]?.message?.content;

    res.json({
      answer: answer || "Die KI hat keine Antwort geliefert."
    });

  } catch (error) {
    console.error("Server Fehler:", error);

    res.status(500).json({
      answer: "Serverfehler: " + error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("TILLBOT KI läuft auf Port " + PORT);
});

