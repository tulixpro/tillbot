const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("./database");

const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "30kb" }));

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.warn("WARNUNG: JWT_SECRET fehlt/ist zu kurz. Temporärer Schlüssel aktiv; bitte in Render dauerhaft setzen.");
}
const TOKEN_SECRET = SECRET && SECRET.length >= 32 ? SECRET : crypto.randomBytes(48).toString("hex");
const FRONTEND = process.env.FRONTEND_ORIGIN || "https://tulixpro.github.io";
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", FRONTEND);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use("/api", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }));
const authLimit = rateLimit({ windowMs: 15 * 60_000, limit: 8, message: { error: "Zu viele Versuche. Bitte 15 Minuten warten." } });
app.use("/api/login", authLimit);
app.use("/api/register", authLimit);

const normalizeUsername = (value) => String(value || "").trim().toLowerCase();
const makeToken = (user) => jwt.sign({ sub: String(user.id) }, TOKEN_SECRET, { expiresIn: "7d" });

function auth(req, res, next) {
  try {
    const raw = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const payload = jwt.verify(raw, TOKEN_SECRET);
    const user = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(Number(payload.sub));
    if (!user) return res.status(401).json({ error: "Konto nicht gefunden" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Bitte anmelden" });
  }
}
function admin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Adminrechte erforderlich" });
  next();
}

app.get("/", (_req, res) => res.type("text").send("TILLBOT 2.0 Server online"));
app.get("/api/status", (_req, res) => res.json({ online: true, name: "TILLBOT 2.0" }));

app.post("/api/register", async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "");
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: "Username: 3–20 Zeichen (a-z, 0-9, _)" });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "Passwort muss 10–128 Zeichen haben" });
  try {
    const hash = await bcrypt.hash(password, 12);
    // Registrierungen sind immer normale Nutzer. Admin wird separat mit Setup-Code freigeschaltet.
    const result = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'user')").run(username, hash);
    const user = { id: Number(result.lastInsertRowid), username, role: "user" };
    res.json({ token: makeToken(user), user });
  } catch (error) {
    if (String(error).includes("UNIQUE")) return res.status(409).json({ error: "Username bereits vergeben" });
    console.error("Register error:", error);
    res.status(500).json({ error: "Registrierung fehlgeschlagen" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(normalizeUsername(req.body.username));
    if (!user || !(await bcrypt.compare(String(req.body.password || ""), user.password_hash))) {
      return res.status(401).json({ error: "Login falsch" });
    }
    res.json({ token: makeToken(user), user: { id: user.id, username: user.username, role: user.role } });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login fehlgeschlagen" });
  }
});

// Admin erstmalig freischalten: eingeloggter passender Benutzer + ADMIN_SETUP_SECRET aus Render.
app.post("/api/admin/bootstrap", auth, (req, res) => {
  const setupSecret = process.env.ADMIN_SETUP_SECRET;
  const adminUsername = normalizeUsername(process.env.ADMIN_USERNAME);
  if (!setupSecret || !adminUsername) return res.status(503).json({ error: "Admin-Setup in Render nicht konfiguriert" });
  if (req.user.username !== adminUsername || req.body.setupSecret !== setupSecret) {
    return res.status(403).json({ error: "Setup-Code oder Admin-Benutzer falsch" });
  }
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(req.user.id);
  res.json({ ok: true, message: "Admin aktiviert. Bitte neu anmelden." });
});

app.get("/api/me", auth, (req, res) => res.json({ user: req.user }));
app.get("/api/chats", auth, (req, res) => res.json(db.prepare("SELECT id,title,updated_at FROM chats WHERE user_id=? ORDER BY updated_at DESC").all(req.user.id)));
app.post("/api/chats", auth, (req, res) => {
  const title = String(req.body.title || "Neuer Chat").slice(0, 100);
  const result = db.prepare("INSERT INTO chats(user_id,title) VALUES(?,?)").run(req.user.id, title);
  res.json({ id: Number(result.lastInsertRowid), title });
});
app.get("/api/chats/:id", auth, (req, res) => {
  const chat = db.prepare("SELECT * FROM chats WHERE id=? AND user_id=?").get(Number(req.params.id), req.user.id);
  if (!chat) return res.status(404).json({ error: "Chat nicht gefunden" });
  res.json({ chat: { id: chat.id, title: chat.title, history: JSON.parse(chat.history) } });
});
app.put("/api/chats/:id", auth, (req, res) => {
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-100) : [];
  const safeHistory = history.filter(m => ["user", "assistant"].includes(m.role) && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content.slice(0, 12000) }));
  const title = String(req.body.title || "Chat").slice(0, 100);
  const result = db.prepare("UPDATE chats SET title=?,history=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?")
    .run(title, JSON.stringify(safeHistory), Number(req.params.id), req.user.id);
  if (!result.changes) return res.status(404).json({ error: "Chat nicht gefunden" });
  res.json({ ok: true });
});
app.delete("/api/chats/:id", auth, (req, res) => {
  const result = db.prepare("DELETE FROM chats WHERE id=? AND user_id=?").run(Number(req.params.id), req.user.id);
  res.json({ ok: !!result.changes });
});
app.get("/api/admin/stats", auth, admin, (_req, res) => res.json({
  users: db.prepare("SELECT COUNT(*) n FROM users").get().n,
  chats: db.prepare("SELECT COUNT(*) n FROM chats").get().n
}));

app.post("/api/chat", auth, async (req, res) => {
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ answer: "GROQ_API_KEY fehlt in Render" });
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-12) : [];
  const messages = [{ role: "system", content: "Du bist TILLBOT, ein freundlicher KI-Assistent. Antworte verständlich, überwiegend Deutsch." },
    ...history.filter(m => ["user", "assistant"].includes(m.role) && typeof m.content === "string")
      .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }))];
  if (req.body.message && messages.length === 1) messages.push({ role: "user", content: String(req.body.message).slice(0, 8000) });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", signal: controller.signal,
      headers: { Authorization: "Bearer " + process.env.GROQ_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.GROQ_MODEL || "openai/gpt-oss-120b", messages, max_completion_tokens: 800, temperature: 0.7 })
    });
    const data = await response.json();
    if (!response.ok) return res.status(502).json({ answer: "Groq Fehler: " + (data.error?.message || response.status) });
    res.json({ answer: data.choices?.[0]?.message?.content || "Keine Antwort" });
  } catch (error) {
    console.error("Chat API error:", error);
    res.status(500).json({ answer: error.name === "AbortError" ? "KI-Anfrage dauerte zu lange" : "KI-Serverfehler" });
  } finally {
    clearTimeout(timeout);
  }
});

app.use((error, _req, res, _next) => {
  console.error("Express error:", error);
  res.status(500).json({ error: "Interner Serverfehler" });
});

const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, "0.0.0.0", () => console.log(`TILLBOT bereit auf 0.0.0.0:${PORT}`));
server.on("error", error => { console.error("Port/Server error:", error); process.exit(1); });
