const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { pool, initDatabase } = require("./database");

const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "3mb" }));

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


async function verifyCaptcha(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // CAPTCHA ist nur aktiv, wenn Secret in Render gesetzt wurde.
  if (!token) return false;
  try {
    const form = new URLSearchParams({secret, response:token});
    if (ip) form.set("remoteip", ip);
    const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});
    const data = await result.json();
    return data.success === true;
  } catch { return false; }
}

const normalizeUsername = (value) => String(value || "").trim().toLowerCase();
const makeToken = (user) => jwt.sign({ sub: String(user.id) }, TOKEN_SECRET, { expiresIn: "7d" });

async function auth(req, res, next) {
  try {
    const raw = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const payload = jwt.verify(raw, TOKEN_SECRET);
    const { rows } = await pool.query("SELECT id, username, role FROM users WHERE id = $1", [Number(payload.sub)]); const user = rows[0];
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
  if (!(await verifyCaptcha(req.body.captchaToken, req.ip))) return res.status(403).json({ error: "CAPTCHA fehlgeschlagen. Bitte erneut bestätigen." });
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "");
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: "Username: 3–20 Zeichen (a-z, 0-9, _)" });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "Passwort muss 10–128 Zeichen haben" });
  try {
    const hash = await bcrypt.hash(password, 12);
    // Registrierungen sind immer normale Nutzer. Admin wird separat mit Setup-Code freigeschaltet.
    const { rows } = await pool.query("INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'user') RETURNING id", [username, hash]);
    const user = { id: Number(rows[0].id), username, role: "user" };
    res.json({ token: makeToken(user), user });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Username bereits vergeben" });
    console.error("Register error:", error);
    res.status(500).json({ error: "Registrierung fehlgeschlagen" });
  }
});

app.post("/api/login", async (req, res) => {
  if (!(await verifyCaptcha(req.body.captchaToken, req.ip))) return res.status(403).json({ error: "CAPTCHA fehlgeschlagen. Bitte erneut bestätigen." });
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [normalizeUsername(req.body.username)]); const user = rows[0];
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
app.post("/api/admin/bootstrap", auth, rateLimit({ windowMs: 15 * 60_000, limit: 3, message: { error: "Zu viele Admin-Setup-Versuche. Bitte später erneut." } }), async (req, res) => {
  const setupSecret = process.env.ADMIN_SETUP_SECRET;
  const adminUsername = normalizeUsername(process.env.ADMIN_USERNAME);
  if (!setupSecret || !adminUsername) return res.status(503).json({ error: "Admin-Setup in Render nicht konfiguriert" });
  if (req.user.username !== adminUsername || req.body.setupSecret !== setupSecret) {
    return res.status(403).json({ error: "Setup-Code oder Admin-Benutzer falsch" });
  }
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [req.user.id]);
  res.json({ ok: true, message: "Admin aktiviert. Bitte neu anmelden." });
});

app.get("/api/me", auth, (req, res) => res.json({ user: req.user }));
app.get("/api/chats", auth, async (req, res) => { const { rows } = await pool.query("SELECT id,title,updated_at FROM chats WHERE user_id=$1 ORDER BY updated_at DESC", [req.user.id]); res.json(rows); });
app.post("/api/chats", auth, async (req, res) => {
  const title = String(req.body.title || "Neuer Chat").slice(0, 100);
  const { rows } = await pool.query("INSERT INTO chats(user_id,title) VALUES($1,$2) RETURNING id", [req.user.id, title]);
  res.json({ id: Number(rows[0].id), title });
});
app.get("/api/chats/:id", auth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM chats WHERE id=$1 AND user_id=$2", [Number(req.params.id), req.user.id]); const chat = rows[0];
  if (!chat) return res.status(404).json({ error: "Chat nicht gefunden" });
  res.json({ chat: { id: chat.id, title: chat.title, history: JSON.parse(chat.history) } });
});
app.put("/api/chats/:id", auth, async (req, res) => {
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-100) : [];
  const safeHistory = history.filter(m => ["user", "assistant"].includes(m.role) && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content.slice(0, 12000) }));
  const title = String(req.body.title || "Chat").slice(0, 100);
  const result = await pool.query("UPDATE chats SET title=$1,history=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3 AND user_id=$4", [title, JSON.stringify(safeHistory), Number(req.params.id), req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Chat nicht gefunden" });
  res.json({ ok: true });
});
app.delete("/api/chats/:id", auth, async (req, res) => {
  const result = await pool.query("DELETE FROM chats WHERE id=$1 AND user_id=$2", [Number(req.params.id), req.user.id]);
  res.json({ ok: result.rowCount > 0 });
});
app.get("/api/admin/stats", auth, admin, async (_req, res) => { const [u,ch]=await Promise.all([pool.query("SELECT COUNT(*) n FROM users"),pool.query("SELECT COUNT(*) n FROM chats")]); res.json({
  users: Number(u.rows[0].n),
  chats: Number(ch.rows[0].n)
}); });


app.get("/api/admin/metrics", auth, admin, async (_req, res) => {
  const mem = process.memoryUsage();
  const dbInfo = Number((await pool.query("SELECT pg_database_size(current_database()) size")).rows[0].size); const [ur,cr]=await Promise.all([pool.query("SELECT COUNT(*) n FROM users"),pool.query("SELECT COUNT(*) n FROM chats")]);
  const cpu = process.cpuUsage();
  const now = process.hrtime.bigint();
  const elapsed = Number(now - (global.__tbCpuTime || now)) / 1e6;
  const cpuDelta = global.__tbCpuUsage ? (cpu.user-global.__tbCpuUsage.user)+(cpu.system-global.__tbCpuUsage.system) : 0;
  global.__tbCpuUsage = cpu; global.__tbCpuTime = now;
  const cpuPercent = elapsed > 0 ? Math.min(100, Math.max(0, cpuDelta / (elapsed * 1000) * 100)) : 0;
  res.set("Cache-Control", "no-store");
  res.json({
    status:"online", uptimeSeconds:Math.floor(process.uptime()),
    cpuProcessPercent:Number(cpuPercent.toFixed(1)),
    memory:{rss:mem.rss,heapUsed:mem.heapUsed,heapTotal:mem.heapTotal},
    systemMemory:{total:require("os").totalmem(),free:require("os").freemem()},
    loadAverage:require("os").loadavg(), databaseBytes:dbInfo,
    users:Number(ur.rows[0].n),
    chats:Number(cr.rows[0].n),
    node:process.version
  });
});

app.post("/api/chat", auth, rateLimit({ windowMs: 60_000, limit: 12, message: { error: "Zu viele Nachrichten. Bitte kurz warten." } }), async (req, res) => {
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ answer: "GROQ_API_KEY fehlt in Render" });
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-12) : [];
  const messages = [{ role: "system", content: "Du bist TILLBOT, ein freundlicher KI-Assistent. Antworte verständlich, überwiegend Deutsch." },
    ...history.filter(m => ["user", "assistant"].includes(m.role) && typeof m.content === "string")
      .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }))];
  const userText = String(req.body.message || "").slice(0, 8000);
  const image = req.body.image;
  if (image && typeof image.data === "string") {
    if (!["image/jpeg", "image/png", "image/webp"].includes(image.mime) || image.data.length > 2_500_000) {
      return res.status(400).json({ answer: "Fotoformat nicht erlaubt oder Bild zu groß (bitte kleineres Foto verwenden)." });
    }
    messages.push({ role: "user", content: [
      { type: "text", text: userText || "Bitte beschreibe dieses Bild." },
      { type: "image_url", image_url: { url: "data:" + image.mime + ";base64," + image.data } }
    ]});
  } else if (userText) {
    messages.push({ role: "user", content: userText });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", signal: controller.signal,
      headers: { Authorization: "Bearer " + process.env.GROQ_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.GROQ_VISION_MODEL || (image ? "meta-llama/llama-4-scout-17b-16e-instruct" : (process.env.GROQ_MODEL || "openai/gpt-oss-120b")), messages, max_completion_tokens: 800, temperature: 0.7 })
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
initDatabase().then(() => { const server = app.listen(PORT, "0.0.0.0", () => console.log(`TILLBOT bereit auf 0.0.0.0:${PORT}`));
server.on("error", error => { console.error("Port/Server error:", error); process.exit(1); }); }).catch(error => { console.error("PostgreSQL Init fehlgeschlagen:", error); process.exit(1); });
