const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const archiver = require("archiver");
const { pool, initDatabase } = require("./database");

const app = express();
// Render forwards requests through one trusted edge proxy. Use a hop count (not `true`)
// so client-supplied X-Forwarded-For values cannot bypass rate-limit IP checks.
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "3mb" }));

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  throw new Error("JWT_SECRET fehlt oder ist zu kurz (mindestens 32 Zeichen). In Render dauerhaft setzen; Serverstart wird aus Sicherheitsgründen abgebrochen.");
}
const TOKEN_SECRET = SECRET;
const FRONTEND = process.env.FRONTEND_ORIGIN || "https://tulixpro.github.io";
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", FRONTEND);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use("/api", (req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
app.use("/api", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }));
const loginLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: { error: "Zu viele fehlgeschlagene Anmeldeversuche. Bitte 15 Minuten warten." } });
const registerLimit = rateLimit({ windowMs: 60 * 60_000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: "Zu viele Registrierungen von diesem Netzwerk. Bitte später erneut versuchen." } });
app.use("/api/login", loginLimit);
app.use("/api/register", registerLimit);


// Native anti-bot protection: rate limits plus a honeypot field.
// This is friction-based protection, not a claim that every automated client can be detected.
function isBotTrapFilled(req) {
  return typeof req.body?.website === "string" && req.body.website.trim().length > 0;
}

const authChallenges = new Map();
const AUTH_POW_DIFFICULTY = 3;
function issueAuthChallenge(req, res) {
  const now = Date.now();
  for (const [id, item] of authChallenges) if (item.expiresAt <= now) authChallenges.delete(id);
  while (authChallenges.size >= 5000) authChallenges.delete(authChallenges.keys().next().value);
  const id = crypto.randomBytes(18).toString("hex");
  const nonce = crypto.randomBytes(24).toString("hex");
  authChallenges.set(id, { nonce, ip: req.ip, expiresAt: now + 120000 });
  res.set("Cache-Control", "no-store").json({ id, nonce, difficulty: AUTH_POW_DIFFICULTY, expiresIn: 120 });
}
function consumeAuthChallenge(req) {
  const id = String(req.body?.challengeId || "");
  const solution = String(req.body?.challengeSolution || "");
  const item = authChallenges.get(id);
  if (!item) return false;
  authChallenges.delete(id);
  if (item.expiresAt <= Date.now() || item.ip !== req.ip || !/^[0-9]{1,12}$/.test(solution)) return false;
  const digest = crypto.createHash("sha256").update(item.nonce + ":" + solution).digest("hex");
  return digest.startsWith("0".repeat(AUTH_POW_DIFFICULTY));
}
app.get("/api/auth/challenge", rateLimit({ windowMs: 60000, limit: 20, standardHeaders: true, legacyHeaders: false }), issueAuthChallenge);

app.get("/api/auth/status", async (_req,res) => {
  let databaseReady=false;
  try { await pool.query("SELECT 1"); databaseReady=true; } catch {}
  res.set("Cache-Control","no-store").json({
    antiBotEnabled:true,
    databaseReady,
    authReady:databaseReady
  });
});

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
async function admin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Adminrechte erforderlich" });
  const path=req.path||"";
  const permission=path.includes("/users")?"users":path.includes("/tickets")?"support":path.includes("/features")?"features":"system";
  try{
    const override=await pool.query("SELECT enabled FROM admin_permission_overrides WHERE user_id=$1 AND permission_key=$2",[req.user.id,permission]);
    if(override.rows.length&&!override.rows[0].enabled)return res.status(403).json({error:"Dir fehlt die Admin-Berechtigung: "+permission});
    // Record admin API access without storing request bodies, tokens, or personal content.
    pool.query("INSERT INTO admin_activity_log(actor_id,action,method,path) VALUES($1,$2,$3,$4)",[req.user.id,req.method+" "+path,req.method,path]).catch(()=>{});
    next();
  }catch(error){console.error("Admin permission check failed:",error.code||error.message);res.status(503).json({error:"Admin-Berechtigungen konnten nicht geprüft werden."})}
}

// Serve only explicitly public frontend files from this repository. Never expose server/database sources or package metadata.
const path = require("path");
const publicRootFiles = new Set(["index.html","studio.html","updates.html","core-demo.html","style.css","clean-theme.css","tillbot-atelier.css","tillbot-monolith.css","app.js","sw.js","manifest.json","studio-manifest.json"]);
app.use((req,res,next)=>{
  if(req.method!=="GET" || req.path.startsWith("/api/")) return next();
  const relative=req.path.startsWith("/") ? req.path.slice(1) : req.path;
  const iconFile=relative.startsWith("icons/") && relative.split("/").length===2 &&
    [".svg",".png",".webp",".ico"].some(ext=>relative.toLowerCase().endsWith(ext));
  if(!publicRootFiles.has(relative) && !iconFile) return next();
  express.static(__dirname,{index:false,dotfiles:"deny",fallthrough:true,maxAge:0})(req,res,next);
});
app.get("/", (_req, res) => res.sendFile(path.join(__dirname,"index.html")));
app.get("/api/status", (_req, res) => res.json({ online: true, name: "TILLBOT 2.0" }));

function emailTransportConfig() {
  const host=String(process.env.SMTP_HOST||"").trim();
  const port=Number(process.env.SMTP_PORT||587);
  const from=String(process.env.SMTP_FROM||"").trim();
  const user=String(process.env.SMTP_USER||"").trim();
  const pass=String(process.env.SMTP_PASS||"");
  const secure=String(process.env.SMTP_SECURE||"").toLowerCase()==="true"||port===465;
  return {host,port,from,user,pass,secure,configured:!!(host&&Number.isInteger(port)&&port>0&&port<65536&&from&&user&&pass)};
}

function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||""))&&String(value).length<=254}
function hashActionToken(token){return crypto.createHash("sha256").update(token).digest("hex")}
async function sendAccountEmail(to,subject,text){
 const c=emailTransportConfig();
 if(!c.configured)throw new Error("SMTP_NOT_CONFIGURED");
 const nodemailer=require("nodemailer");
 const transporter=nodemailer.createTransport({host:c.host,port:c.port,secure:c.secure,auth:{user:c.user,pass:c.pass},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000});
 await transporter.sendMail({from:c.from,to,subject,text});
}
async function createEmailAction(userId,purpose){
 await pool.query("DELETE FROM email_action_tokens WHERE expires_at<NOW()");
 const raw=crypto.randomBytes(32).toString("hex"),tokenHash=hashActionToken(raw);
 await pool.query("DELETE FROM email_action_tokens WHERE user_id=$1 AND purpose=$2",[userId,purpose]);
 await pool.query("INSERT INTO email_action_tokens(user_id,token_hash,purpose,expires_at) VALUES($1,$2,$3,NOW()+$4::interval)",[userId,tokenHash,purpose,purpose==="verify"?"24 hours":"1 hour"]);
 return raw;
}

app.get("/api/admin/email-status",auth,admin,async(_req,res)=>{
 const c=emailTransportConfig();
 res.set("Cache-Control","no-store").json({configured:c.configured,host:c.configured?c.host:null,port:c.configured?c.port:null,secure:c.configured?c.secure:null,from:c.configured?c.from:null});
});
app.post("/api/admin/email-test",auth,admin,rateLimit({windowMs:15*60_000,limit:3,message:{error:"Zu viele Testmails. Bitte 15 Minuten warten."}}),async(req,res)=>{
 const c=emailTransportConfig(),to=String(req.body.to||"").trim().slice(0,254);
 if(!c.configured)return res.status(503).json({error:"SMTP ist nicht vollständig konfiguriert. Setze SMTP_HOST, SMTP_PORT, SMTP_FROM, SMTP_USER und SMTP_PASS als Render-Umgebungsvariablen."});
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))return res.status(400).json({error:"Bitte eine gültige Empfänger-E-Mail-Adresse eingeben."});
 try{
  const nodemailer=require("nodemailer");
  const transporter=nodemailer.createTransport({host:c.host,port:c.port,secure:c.secure,auth:{user:c.user,pass:c.pass},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000});
  await transporter.sendMail({from:c.from,to,subject:"TILLBOT – SMTP-Test erfolgreich",text:"Diese Testnachricht wurde vom TILLBOT-Admin-Panel versendet. Der SMTP-Versand ist erreichbar."});
  res.json({ok:true,message:"Testmail wurde vom SMTP-Server angenommen. Prüfe auch den Spam-Ordner."});
 }catch(error){console.error("SMTP test failed:",error.code||error.message);res.status(502).json({error:"E-Mail-Versand fehlgeschlagen. Prüfe SMTP-Host, Port, TLS und Zugangsdaten in Render."})}
});


app.put("/api/admin/announcement", auth, admin, async (req,res)=>{
 const message=String(req.body.message||"").trim().slice(0,500);
 const title=String(req.body.title||"TILLBOT-Mitteilung").trim().slice(0,90)||"TILLBOT-Mitteilung";
 const category=["update","maintenance","release","feature","security","event","general"].includes(req.body.category)?req.body.category:"general";
 const level=["info","warning","critical"].includes(req.body.level)?req.body.level:"info";
 const linkUrl=String(req.body.linkUrl||"").trim().slice(0,500);
 if(linkUrl){try{const u=new URL(linkUrl);if(u.protocol!=="https:")throw new Error("HTTPS erforderlich");}catch{return res.status(400).json({error:"Bitte einen gültigen HTTPS-Link eintragen."})}}
 try{
  await pool.query("INSERT INTO app_settings(key,value) VALUES('public_announcement',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[message]);
  if(message)await pool.query("INSERT INTO studio_announcements(title,message,category,level,link_url,published) VALUES($1,$2,$3,$4,$5,TRUE)",[title,message,category,level,linkUrl]);
  res.json({ok:true,message:"Ankündigung gespeichert und im Verlauf veröffentlicht."});
 }catch(e){console.error("announcement error",e);res.status(500).json({error:"Ankündigung konnte nicht gespeichert werden."})}
});
app.get("/api/announcements",async(_req,res)=>{
 try{const {rows}=await pool.query("SELECT id,title,message,category,level,link_url,created_at FROM studio_announcements WHERE published=TRUE ORDER BY created_at DESC LIMIT 50");res.set("Cache-Control","no-store").json(rows)}
 catch{res.status(503).json({error:"Ankündigungen sind momentan nicht verfügbar."})}
});
app.get("/api/admin/announcements",auth,admin,async(_req,res)=>{
 try{const {rows}=await pool.query("SELECT id,title,message,category,level,link_url,published,created_at FROM studio_announcements ORDER BY created_at DESC LIMIT 100");res.set("Cache-Control","no-store").json(rows)}
 catch{res.status(503).json({error:"Ankündigungsverlauf ist momentan nicht verfügbar."})}
});
app.get("/api/notifications", async (_req,res)=>{
 try{
  const m=await getMaintenance();
  const {rows:ann}=await pool.query("SELECT value FROM app_settings WHERE key='public_announcement'");
  const {rows:meta}=await pool.query("SELECT title,category,level FROM studio_announcements WHERE published=TRUE ORDER BY created_at DESC LIMIT 1");
  const announcement=ann[0]?.value||null,latest=meta[0]||{};
  if(m.enabled)return res.set("Cache-Control","no-store").json({notice:m.message,announcement,title:latest.title||"Wartungsarbeiten",category:"maintenance",level:"critical"});
  const mem=process.memoryUsage(),ratio=mem.heapUsed/Math.max(mem.heapTotal,1);
  if(ratio>.88)return res.set("Cache-Control","no-store").json({notice:"Der Server ist gerade stark ausgelastet. Antworten können länger dauern.",announcement,title:latest.title||"",category:latest.category||"general",level:"warning"});
  return res.set("Cache-Control","no-store").json({notice:null,announcement,title:latest.title||"",category:latest.category||"general",level:latest.level||"info"});
 }catch{return res.set("Cache-Control","no-store").json({notice:"Der Systemstatus ist momentan nicht verfügbar.",level:"warning"})}
});
// Public, privacy-safe operational notices; never expose logs or user data.
app.post("/api/register", async (req, res) => {
  if (isBotTrapFilled(req) || !consumeAuthChallenge(req)) return res.status(400).json({ error: "Sicherheitsprüfung fehlgeschlagen. Bitte lade die Anmeldung neu und versuche es erneut." });
  const username=normalizeUsername(req.body.username),password=String(req.body.password||""),email=String(req.body.email||"").trim().toLowerCase();
  if(!/^[a-z0-9_]{3,20}$/.test(username))return res.status(400).json({error:"Username: 3–20 Zeichen (a-z, 0-9, _)"});
  if(password.length<10||password.length>128)return res.status(400).json({error:"Passwort muss 10–128 Zeichen haben"});
  if(!validEmail(email))return res.status(400).json({error:"Bitte gib eine gültige E-Mail-Adresse ein."});
  try{
    if(!emailTransportConfig().configured)return res.status(503).json({error:"E-Mail-Versand ist noch nicht eingerichtet. Bitte später erneut versuchen."});
    const hash=await bcrypt.hash(password,12);
    const {rows}=await pool.query("INSERT INTO users(username,email,email_verified,password_hash,role) VALUES($1,$2,FALSE,$3,'user') RETURNING id",[username,email,hash]);
    const userId=Number(rows[0].id),token=await createEmailAction(userId,"verify");
    const link=(process.env.FRONTEND_URL||"https://tulixpro.github.io/tillbot/")+"#verify="+encodeURIComponent(token);
    await sendAccountEmail(email,"TILLBOT – E-Mail-Adresse bestätigen","Hallo "+username+",\n\nbitte bestätige deine E-Mail-Adresse über diesen Link (24 Stunden gültig):\n"+link+"\n\nFalls du kein Konto erstellt hast, kannst du diese Nachricht ignorieren.");
    res.status(202).json({pendingVerification:true,message:"Konto erstellt. Bitte öffne den Bestätigungslink in deiner E-Mail, bevor du dich anmeldest."});
  }catch(error){
    if(error.code==="23505")return res.status(409).json({error:"Benutzername oder E-Mail-Adresse ist bereits registriert."});
    console.error("Register error:",error.code||error.message);res.status(500).json({error:"Registrierung fehlgeschlagen. Bitte später erneut versuchen."});
  }
});
app.get("/api/auth/verify",async(req,res)=>{
 const token=String(req.query.token||"");
 if(!/^[a-f0-9]{64}$/.test(token))return res.status(400).json({error:"Bestätigungslink ungültig oder abgelaufen."});
 const result=await pool.query("WITH consumed AS (DELETE FROM email_action_tokens WHERE token_hash=$1 AND purpose='verify' AND expires_at>NOW() RETURNING user_id) UPDATE users SET email_verified=TRUE WHERE id=(SELECT user_id FROM consumed) RETURNING id",[hashActionToken(token)]);
 if(!result.rowCount)return res.status(400).json({error:"Bestätigungslink ungültig oder abgelaufen."});
 await pool.query("DELETE FROM email_action_tokens WHERE user_id=$1 AND purpose='verify'",[result.rows[0].id]);
 res.json({ok:true,message:"E-Mail bestätigt. Du kannst dich jetzt anmelden."});
});
app.post("/api/auth/resend-verification",rateLimit({windowMs:60*60_000,limit:3}),async(req,res)=>{
 const email=String(req.body.email||"").trim().toLowerCase();
 if(!validEmail(email))return res.status(400).json({error:"Bitte gib eine gültige E-Mail-Adresse ein."});
 try{
  const {rows}=await pool.query("SELECT id,username FROM users WHERE email=$1 AND email_verified=FALSE",[email]);
  if(rows[0]){const token=await createEmailAction(rows[0].id,"verify"),link=(process.env.FRONTEND_URL||"https://tulixpro.github.io/tillbot/")+"#verify="+encodeURIComponent(token);await sendAccountEmail(email,"TILLBOT – E-Mail-Adresse bestätigen","Hallo "+rows[0].username+",\n\nbitte bestätige deine E-Mail-Adresse über diesen Link (24 Stunden gültig):\n"+link);}
  res.json({ok:true,message:"Falls ein unbestätigtes Konto zu dieser Adresse gehört, wurde eine neue Bestätigungs-E-Mail versendet."});
 }catch(error){console.error("Verification resend failed:",error.code||error.message);res.status(503).json({error:"E-Mail-Versand momentan nicht verfügbar."})}
});
app.post("/api/auth/forgot-password",rateLimit({windowMs:60*60_000,limit:3}),async(req,res)=>{
 const email=String(req.body.email||"").trim().toLowerCase();
 if(!validEmail(email))return res.status(400).json({error:"Bitte gib eine gültige E-Mail-Adresse ein."});
 try{
  const {rows}=await pool.query("SELECT id,username,email_verified FROM users WHERE email=$1",[email]);
  if(rows[0]?.email_verified){
   const token=await createEmailAction(rows[0].id,"reset");
   const link=(process.env.FRONTEND_URL||"https://tulixpro.github.io/tillbot/")+"#reset="+encodeURIComponent(token);
   await sendAccountEmail(email,"TILLBOT – Passwort zurücksetzen","Hallo "+rows[0].username+",\n\nüber diesen Link kannst du innerhalb einer Stunde ein neues Passwort festlegen:\n"+link+"\n\nFalls du das nicht angefordert hast, ignoriere diese Nachricht.");
  }
  res.json({ok:true,message:"Falls ein bestätigtes Konto zu dieser Adresse gehört, wurde eine E-Mail mit weiteren Schritten versendet."});
 }catch(error){console.error("Password reset request failed:",error.code||error.message);res.status(503).json({error:"E-Mail-Versand momentan nicht verfügbar. Bitte später erneut versuchen."})}
});
app.post("/api/auth/reset-password",rateLimit({windowMs:15*60_000,limit:5}),async(req,res)=>{
 const token=String(req.body.token||""),password=String(req.body.password||"");
 if(!/^[a-f0-9]{64}$/.test(token))return res.status(400).json({error:"Link ungültig oder abgelaufen."});
 if(password.length<10||password.length>128)return res.status(400).json({error:"Passwort muss 10–128 Zeichen haben."});
 const hash=await bcrypt.hash(password,12);
 const result=await pool.query("WITH consumed AS (DELETE FROM email_action_tokens WHERE token_hash=$1 AND purpose='reset' AND expires_at>NOW() RETURNING user_id) UPDATE users SET password_hash=$2 WHERE id=(SELECT user_id FROM consumed) RETURNING id",[hashActionToken(token),hash]);
 if(!result.rowCount)return res.status(400).json({error:"Link ungültig oder abgelaufen."});
 await pool.query("DELETE FROM email_action_tokens WHERE user_id=$1",[result.rows[0].id]);
 res.json({ok:true,message:"Passwort geändert. Bitte melde dich neu an."});
});

app.post("/api/login", async (req, res) => {
  if (isBotTrapFilled(req)) return res.status(400).json({ error: "Anfrage konnte nicht verarbeitet werden." });
  try {
    const identity=String(req.body.username||"").trim().toLowerCase(); const { rows } = await pool.query("SELECT * FROM users WHERE username = $1 OR lower(email) = $2 LIMIT 1", [normalizeUsername(identity), identity]); const user = rows[0];
    if (!user || !(await bcrypt.compare(String(req.body.password || ""), user.password_hash))) {
      return res.status(401).json({ error: "Login falsch" });
    }
    if(user.email && !user.email_verified)return res.status(403).json({error:"Bitte bestätige zuerst deine E-Mail-Adresse."});
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
  if (!setupSecret || !adminUsername) return res.status(503).json({ error: "Admin-Setup in Render nicht konfiguriert (ADMIN_SETUP_SECRET und ADMIN_USERNAME prüfen)" });
  if (req.user.username !== adminUsername || req.body.setupSecret !== setupSecret) {
    return res.status(403).json({ error: "Setup-Code oder Admin-Benutzer falsch" });
  }
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [req.user.id]);
  res.json({ ok: true, message: "Admin aktiviert. Bitte neu anmelden." });
});

app.get("/api/me", auth, (req, res) => res.json({ user: req.user }));

const availableGroqModels=()=>[...new Set(["openai/gpt-oss-120b","openai/gpt-oss-20b","qwen/qwen3.8-27b",...(process.env.GROQ_ALLOWED_MODELS||"").split(",").map(x=>x.trim()).filter(Boolean)])].filter(x=>x&&x!=="llama-3.3-70b-versatile").slice(0,12);
app.get("/api/preferences",auth,async(req,res)=>{
 const {rows}=await pool.query("SELECT instructions,model FROM user_preferences WHERE user_id=$1",[req.user.id]);
 const p=rows[0]||{instructions:"",model:process.env.GROQ_MODEL||"openai/gpt-oss-120b"};
 res.set("Cache-Control","no-store").json({instructions:p.instructions,model:availableGroqModels().includes(p.model)?p.model:availableGroqModels()[0],models:availableGroqModels()});
});
app.put("/api/preferences",auth,async(req,res)=>{
 const instructions=String(req.body.instructions||"").trim().slice(0,4000),model=String(req.body.model||"");
 if(!availableGroqModels().includes(model))return res.status(400).json({error:"Dieses KI-Modell ist nicht freigegeben. Bitte Admin-Konfiguration prüfen."});
 await pool.query("INSERT INTO user_preferences(user_id,instructions,model) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET instructions=EXCLUDED.instructions,model=EXCLUDED.model,updated_at=NOW()",[req.user.id,instructions,model]);
 res.json({ok:true,instructions,model});
});
async function featureEnabled(key){const {rows}=await pool.query("SELECT enabled FROM feature_flags WHERE key=$1",[key]);return rows[0]?.enabled===true}
app.get("/api/features",async(_req,res)=>{
 const {rows}=await pool.query("SELECT key,enabled FROM feature_flags ORDER BY key");
 res.set("Cache-Control","no-store").json(Object.fromEntries(rows.map(x=>[x.key,x.enabled])));
});
app.get("/api/admin/features",auth,admin,async(_req,res)=>{
 const {rows}=await pool.query("SELECT key,enabled,description,updated_at FROM feature_flags ORDER BY key");
 res.set("Cache-Control","no-store").json(rows);
});
app.put("/api/admin/features/:key",auth,admin,async(req,res)=>{
 const key=String(req.params.key);const providerKeys={image_generation:"IMAGE_API_KEY",web_search:"TAVILY_API_KEY",public_api:"PUBLIC_API_ENABLED"};if(req.body.enabled===true&&providerKeys[key]&&!process.env[providerKeys[key]])return res.status(409).json({error:"Diese Funktion kann erst aktiviert werden, wenn "+providerKeys[key]+" in der Serverumgebung konfiguriert ist."});
 const enabled=typeof req.body.enabled==="boolean"?req.body.enabled:null;
 if(enabled===null)return res.status(400).json({error:"enabled muss true oder false sein."});
 const {rows}=await pool.query("UPDATE feature_flags SET enabled=$1,updated_at=NOW() WHERE key=$2 RETURNING key,enabled,description,updated_at",[enabled,String(req.params.key)]);
 if(!rows[0])return res.status(404).json({error:"Unbekannte Funktion."});
 res.json(rows[0]);
});
app.get("/api/admin/permissions",auth,admin,async(_req,res)=>{
 const {rows}=await pool.query("SELECT u.id,u.username,p.permission_key,p.enabled FROM users u LEFT JOIN admin_permission_overrides p ON p.user_id=u.id WHERE u.role='admin' ORDER BY u.id,p.permission_key");
 const map=new Map();rows.forEach(r=>{if(!map.has(r.id))map.set(r.id,{id:r.id,username:r.username,permissions:{users:true,support:true,features:true,system:true}});if(r.permission_key)map.get(r.id).permissions[r.permission_key]=r.enabled});
 res.set("Cache-Control","no-store").json([...map.values()]);
});
app.put("/api/admin/permissions/:id",auth,admin,async(req,res)=>{
 const id=Number(req.params.id),key=String(req.body.permission||""),enabled=req.body.enabled;
 if(!Number.isInteger(id)||id<1||!["users","support","features","system"].includes(key)||typeof enabled!=="boolean")return res.status(400).json({error:"Ungültige Berechtigung."});
 if(id===Number(req.user.id))return res.status(400).json({error:"Eigene Berechtigungen können hier nicht geändert werden."});
 const target=await pool.query("SELECT id FROM users WHERE id=$1 AND role='admin'",[id]);if(!target.rows[0])return res.status(404).json({error:"Admin-Konto nicht gefunden."});
 await pool.query("INSERT INTO admin_permission_overrides(user_id,permission_key,enabled) VALUES($1,$2,$3) ON CONFLICT(user_id,permission_key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=NOW()",[id,key,enabled]);
 res.json({ok:true,userId:id,permission:key,enabled});
});
const RENDER_SERVICE_ID=process.env.TILLBOT_RENDER_SERVICE_ID||"srv-dbrn82bm8hqs73daniq0";
async function renderApi(path,options={}){
 const key=String(process.env.RENDER_API_KEY||"").trim();
 if(!key)throw Object.assign(new Error("Render API ist noch nicht verbunden. Hinterlege RENDER_API_KEY in den geschützten Render-Umgebungsvariablen."),{status:503});
 const response=await fetch("https://api.render.com/v1"+path,{...options,headers:{"Authorization":"Bearer "+key,"Accept":"application/json","Content-Type":"application/json",...(options.headers||{})}});
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw Object.assign(new Error(body.message||body.error||("Render API Fehler ("+response.status+")")),{status:response.status});
 return body;
}
app.get("/api/admin/deployments",auth,admin,async(_req,res)=>{
 try{
  const rows=await renderApi("/services/"+encodeURIComponent(RENDER_SERVICE_ID)+"/deploys?limit=20");
  const deployments=(Array.isArray(rows)?rows:[]).map(x=>{const d=x.deploy||x;return{id:d.id,status:d.status,createdAt:d.createdAt,updatedAt:d.updatedAt,finishedAt:d.finishedAt,commit:d.commit?{id:d.commit.id,message:d.commit.message,createdAt:d.commit.createdAt}:null,trigger:d.trigger,reason:d.reason}});
  res.set("Cache-Control","no-store").json({serviceId:RENDER_SERVICE_ID,deployments});
 }catch(e){res.status(e.status||502).json({error:e.message||"Deployments konnten nicht geladen werden."})}
});
app.post("/api/admin/deployments",auth,admin,rateLimit({windowMs:60000,limit:3}),async(req,res)=>{
 try{
  const clearCache=req.body?.clearCache===true;
  const result=await renderApi("/services/"+encodeURIComponent(RENDER_SERVICE_ID)+"/deploys",{method:"POST",body:JSON.stringify({clearCache:clearCache?"clear":"do_not_clear"})});
  const d=result.deploy||result;
  res.status(202).json({ok:true,id:d.id,status:d.status||"created",message:"Deployment wurde an Render übergeben."});
 }catch(e){res.status(e.status||502).json({error:e.message||"Deployment konnte nicht gestartet werden."})}
});
app.get("/api/admin/activity",auth,admin,async(_req,res)=>{
 const {rows}=await pool.query("SELECT l.id,l.action,l.method,l.path,l.created_at,u.username FROM admin_activity_log l LEFT JOIN users u ON u.id=l.actor_id ORDER BY l.created_at DESC LIMIT 100");
 res.set("Cache-Control","no-store").json(rows);
});
app.get("/api/memories",auth,async(req,res)=>{
 if(!await featureEnabled("memory"))return res.status(403).json({error:"TILLBOT Memory ist deaktiviert."});
 const {rows}=await pool.query("SELECT id,title,content,created_at,updated_at FROM user_memories WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100",[req.user.id]);
 res.set("Cache-Control","no-store").json(rows);
});
app.post("/api/memories",auth,rateLimit({windowMs:60000,limit:20}),async(req,res)=>{
 if(!await featureEnabled("memory"))return res.status(403).json({error:"TILLBOT Memory ist deaktiviert."});
 const title=String(req.body.title||"Erinnerung").trim().slice(0,80),content=String(req.body.content||"").trim().slice(0,1000);
 if(content.length<2)return res.status(400).json({error:"Bitte einen Erinnerungstext eingeben."});
 const {rows}=await pool.query("INSERT INTO user_memories(user_id,title,content) VALUES($1,$2,$3) RETURNING id,title,content,created_at,updated_at",[req.user.id,title||"Erinnerung",content]);
 res.status(201).json(rows[0]);
});
app.delete("/api/memories/:id",auth,async(req,res)=>{
 if(!await featureEnabled("memory"))return res.status(403).json({error:"TILLBOT Memory ist deaktiviert."});
 const {rowCount}=await pool.query("DELETE FROM user_memories WHERE id=$1 AND user_id=$2",[Number(req.params.id),req.user.id]);
 res.json({ok:rowCount>0});
});
app.get("/api/workspaces",auth,async(req,res)=>{
 if(!await featureEnabled("workspaces"))return res.status(403).json({error:"Workspaces sind deaktiviert."});
 const {rows}=await pool.query("SELECT w.id,w.title,w.description,w.created_at,w.updated_at,wm.role FROM workspaces w JOIN workspace_members wm ON wm.workspace_id=w.id WHERE wm.user_id=$1 ORDER BY w.updated_at DESC LIMIT 100",[req.user.id]);
 res.set("Cache-Control","no-store").json(rows);
});
app.post("/api/workspaces",auth,rateLimit({windowMs:60000,limit:12}),async(req,res)=>{
 if(!await featureEnabled("workspaces"))return res.status(403).json({error:"Workspaces sind deaktiviert."});
 const title=String(req.body.title||"").trim().slice(0,100),description=String(req.body.description||"").trim().slice(0,500);
 if(title.length<2)return res.status(400).json({error:"Projektname muss mindestens 2 Zeichen haben."});
 const client=await pool.connect();
 try{await client.query("BEGIN");const w=await client.query("INSERT INTO workspaces(owner_id,title,description) VALUES($1,$2,$3) RETURNING id,title,description,created_at,updated_at",[req.user.id,title,description]);await client.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'owner')",[w.rows[0].id,req.user.id]);await client.query("COMMIT");res.status(201).json({...w.rows[0],role:"owner"})}
 catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
});
app.put("/api/workspaces/:id",auth,async(req,res)=>{
 if(!await featureEnabled("workspaces"))return res.status(403).json({error:"Workspaces sind deaktiviert."});
 const title=String(req.body.title||"").trim().slice(0,100),description=String(req.body.description||"").trim().slice(0,500);
 if(title.length<2)return res.status(400).json({error:"Projektname muss mindestens 2 Zeichen haben."});
 const {rows}=await pool.query("UPDATE workspaces SET title=$1,description=$2,updated_at=NOW() WHERE id=$3 AND owner_id=$4 RETURNING id,title,description,created_at,updated_at",[title,description,Number(req.params.id),req.user.id]);
 if(!rows[0])return res.status(404).json({error:"Workspace nicht gefunden oder keine Berechtigung."});
 res.json(rows[0]);
});
app.delete("/api/workspaces/:id",auth,async(req,res)=>{
 if(!await featureEnabled("workspaces"))return res.status(403).json({error:"Workspaces sind deaktiviert."});
 const {rowCount}=await pool.query("DELETE FROM workspaces WHERE id=$1 AND owner_id=$2",[Number(req.params.id),req.user.id]);
 res.json({ok:rowCount>0});
});

app.post("/api/support/tickets",auth,rateLimit({windowMs:60000,limit:4}),async(req,res)=>{const subject=String(req.body.subject||"").trim().slice(0,120),message=String(req.body.message||"").trim().slice(0,4000);if(subject.length<4||message.length<10)return res.status(400).json({error:"Betreff (min. 4) und Nachricht (min. 10 Zeichen) erforderlich."});const {rows}=await pool.query("INSERT INTO support_tickets(user_id,subject,message) VALUES($1,$2,$3) RETURNING id,status,created_at",[req.user.id,subject,message]);res.status(201).json({ticket:rows[0]})});
app.get("/api/support/tickets",auth,async(req,res)=>{const {rows}=req.user.role==="admin"?await pool.query("SELECT t.*,u.username FROM support_tickets t JOIN users u ON u.id=t.user_id ORDER BY t.updated_at DESC LIMIT 100"):await pool.query("SELECT id,subject,message,status,admin_reply,created_at,updated_at FROM support_tickets WHERE user_id=$1 ORDER BY updated_at DESC",[req.user.id]);res.json(rows)});
app.patch("/api/admin/tickets/:id",auth,admin,async(req,res)=>{const status=["open","in_progress","closed"].includes(req.body.status)?req.body.status:null,reply=typeof req.body.reply==="string"?req.body.reply.trim().slice(0,4000):null;if(!status&&reply===null)return res.status(400).json({error:"Status oder Antwort angeben"});const {rows}=await pool.query("UPDATE support_tickets SET status=COALESCE($1,status),admin_reply=COALESCE($2,admin_reply),updated_at=CURRENT_TIMESTAMP WHERE id=$3 RETURNING id,status,admin_reply,updated_at",[status,reply,Number(req.params.id)]);if(!rows[0])return res.status(404).json({error:"Ticket nicht gefunden"});res.json({ticket:rows[0]})});
async function getMaintenance(){
 const {rows}=await pool.query("SELECT key,value FROM app_settings WHERE key IN ('maintenance_enabled','maintenance_message')");
 const settings=Object.fromEntries(rows.map(r=>[r.key,r.value]));
 const berlinParts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Berlin",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
 const berlinHour=Number(berlinParts.find(p=>p.type==="hour")?.value||0),berlinMinute=Number(berlinParts.find(p=>p.type==="minute")?.value||0);
 const securityWindow=berlinHour===0&&berlinMinute<10;
 const manual=settings.maintenance_enabled==="true",enabled=manual||securityWindow;
 const message=securityWindow&&!manual?"🛡️ TILLBOT-Sicherheitscheck läuft gerade\nWir prüfen im Hintergrund, ob alles sicher und funktionsfähig ist. Bitte hab einen kurzen Moment Geduld – der KI-Chat ist währenddessen pausiert. Gleich geht’s weiter!":String(settings.maintenance_message||process.env.MAINTENANCE_MESSAGE||"TILLBOT wird gerade gewartet. Bitte später erneut versuchen.").slice(0,300);
 return {enabled,message,mode:securityWindow&&!manual?"security":manual?"maintenance":"normal",securityCheck:securityWindow};
}
app.get("/api/maintenance",async(_req,res)=>{try{res.json(await getMaintenance())}catch{res.status(503).json({enabled:false,message:"Status derzeit nicht verfügbar"})}});
app.put("/api/admin/maintenance",auth,admin,async(req,res)=>{
 const enabled=!!req.body.enabled,message=typeof req.body.message==="string"?req.body.message.trim().slice(0,300):null;
 await pool.query("INSERT INTO app_settings(key,value) VALUES('maintenance_enabled',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[String(enabled)]);
 if(message!==null&&message.length>=5)await pool.query("INSERT INTO app_settings(key,value) VALUES('maintenance_message',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[message]);
 if(enabled)await pool.query("INSERT INTO studio_announcements(title,message,category,level,published) VALUES($1,$2,'maintenance','critical',TRUE)",["Wartungsarbeiten",message||"TILLBOT wird gerade gewartet. Bitte später erneut versuchen."]);
 res.json({ok:true,enabled,message:message||"TILLBOT wird gerade gewartet. Bitte später erneut versuchen."})
});
app.get("/api/chats", auth, async (req, res) => { const q=String(req.query.search||"").trim().slice(0,100); const { rows } = await pool.query("SELECT id,title,updated_at FROM chats WHERE user_id=$1 AND ($2='' OR title ILIKE $3 OR history ILIKE $3) ORDER BY updated_at DESC LIMIT 200", [req.user.id,q,"%"+q+"%"]); res.set("Cache-Control","no-store").json(rows); });
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

// Admin user management (role changes are server-authorized).
app.get("/api/admin/users", auth, admin, async (_req,res)=>{
 const {rows}=await pool.query("SELECT id,username,role,created_at,email_verified FROM users ORDER BY id ASC LIMIT 500");
 res.set("Cache-Control","no-store");res.json(rows);
});
app.put("/api/admin/users/:id/role", auth, admin, async (req,res)=>{
 const id=Number(req.params.id),role=req.body.role;
 if(!Number.isInteger(id)||id<1||!["user","admin"].includes(role))return res.status(400).json({error:"Ungültige Benutzer-ID oder Rolle"});
 if(id===Number(req.user.id)&&role!=="admin")return res.status(400).json({error:"Du kannst dir selbst nicht die Adminrechte entziehen."});
 const {rows}=await pool.query("UPDATE users SET role=$1 WHERE id=$2 RETURNING id,username,role",[role,id]);
 if(!rows[0])return res.status(404).json({error:"Benutzer nicht gefunden"});
 res.json({user:rows[0]});
});

// Defensive configuration audit (admin-only; exposes booleans, never secret values).
app.get("/api/admin/security-audit", auth, admin, async (_req,res)=>{
  const checks=[
    {name:"JWT-Schlüssel dauerhaft gesetzt",ok:!!(process.env.JWT_SECRET&&process.env.JWT_SECRET.length>=32),severity:"critical",detail:"JWT_SECRET muss in Render dauerhaft und mit mindestens 32 Zeichen gesetzt sein."},
    {name:"Eigener Bot-Schutz aktiv",ok:true,severity:"medium",detail:"IP-basierte API- und Auth-Limits, zusätzliche kontobasierte Chat-Limits, Eingabevalidierung, Bilddaten-Prüfung und ein serverseitiges Honeypot-Feld sind aktiv. Die Limits liegen aktuell im Prozessspeicher und benötigen für mehrere Instanzen einen gemeinsamen Speicher."},
    {name:"KI-API-Schlüssel gesetzt",ok:!!process.env.GROQ_API_KEY,severity:"high",detail:"GROQ_API_KEY ist erforderlich, damit Chat-Anfragen funktionieren."},
    {name:"HTTPS-Frontend",ok:String(process.env.FRONTEND_ORIGIN||"https://tulixpro.github.io").startsWith("https://"),severity:"medium",detail:"Frontend-Origin sollte HTTPS verwenden."},
    {name:"Helmet-Sicherheitsheader",ok:true,severity:"medium",detail:"Helmet ist im Express-Server aktiviert; CSP wird separat über Hosting/Policy verwaltet."},
    {name:"API-Rate-Limit",ok:true,severity:"medium",detail:"Globales API-Limit sowie zusätzliche Limits für Login/Registrierung sind aktiv."},
    {name:"Passwort-Mindestlänge",ok:true,severity:"medium",detail:"Registrierung verlangt mindestens 10 Zeichen; stärkere Passwörter empfehlen."}
  ];
  let dbOk=false;try{await pool.query("SELECT 1");dbOk=true}catch{}
  checks.push({name:"Datenbank erreichbar",ok:dbOk,severity:"high",detail:dbOk?"PostgreSQL antwortet auf SELECT 1.":"Datenbankverbindung fehlgeschlagen."});
  res.set("Cache-Control","no-store").json({checkedAt:new Date().toISOString(),checks,score:checks.filter(c=>c.ok).length,total:checks.length,note:"Konfigurationscheck, kein vollständiger Penetrationstest und keine Live-Erkennung von Angreifern."});
});

app.get("/api/admin/stats", auth, admin, async (_req, res) => { const [u,ch]=await Promise.all([pool.query("SELECT COUNT(*) n FROM users"),pool.query("SELECT COUNT(*) n FROM chats")]); res.json({
  users: Number(u.rows[0].n),
  chats: Number(ch.rows[0].n)
}); });

// Aggregated admin overview: counts and metadata only, never chat contents or credentials.
app.get("/api/admin/analytics",auth,admin,async(_req,res)=>{
 try{
  const [users,chats,usage]=await Promise.all([
   pool.query("SELECT to_char(day::date,'DD.MM') label,COUNT(u.id)::int value FROM generate_series(CURRENT_DATE-6,CURRENT_DATE,INTERVAL '1 day') day LEFT JOIN users u ON u.created_at::date=day::date GROUP BY day ORDER BY day"),
   pool.query("SELECT to_char(day::date,'DD.MM') label,COUNT(c.id)::int value FROM generate_series(CURRENT_DATE-6,CURRENT_DATE,INTERVAL '1 day') day LEFT JOIN chats c ON c.created_at::date=day::date GROUP BY day ORDER BY day"),
   pool.query("SELECT to_char(usage_date,'DD.MM') label,COALESCE(SUM(message_count),0)::int value FROM daily_usage_stats WHERE usage_date>=CURRENT_DATE-6 GROUP BY usage_date ORDER BY usage_date")
  ]);
  res.set("Cache-Control","no-store").json({users:users.rows,chats:chats.rows,messages:usage.rows,checkedAt:new Date().toISOString()});
 }catch(e){console.error("Admin analytics failed:",e.code||e.message);res.status(500).json({error:"Analytics nicht verfügbar."})}
});
app.get("/api/admin/logs",auth,admin,async(_req,res)=>{
 const {rows}=await pool.query("SELECT id,level,source,message,created_at FROM system_error_logs ORDER BY created_at DESC LIMIT 100");
 res.set("Cache-Control","no-store").json(rows);
});
// Compact health summary for the admin control room. Counts and operational signals only.
app.get("/api/admin/health-overview",auth,admin,async(_req,res)=>{
 try{
  const [errors,latest]=await Promise.all([
   pool.query("SELECT COUNT(*)::int total,COUNT(*) FILTER (WHERE level IN ('error','critical','fatal'))::int severe FROM system_error_logs WHERE created_at>=NOW()-INTERVAL '24 hours'"),
   pool.query("SELECT level,source,message,created_at FROM system_error_logs ORDER BY created_at DESC LIMIT 8")
  ]);
  const mem=process.memoryUsage(),os=require("os"),cores=Math.max(1,os.cpus().length),load=os.loadavg();
  const systemMemoryPercent=Number(((os.totalmem()-os.freemem())/os.totalmem()*100).toFixed(1));
  const loadPerCore=Number((load[0]/cores).toFixed(2));
  const errors24h=Number(errors.rows[0]?.total||0),severe24h=Number(errors.rows[0]?.severe||0);
  const warnings=[];
  if(systemMemoryPercent>=90)warnings.push({level:"critical",message:"Systemspeicher ist sehr stark ausgelastet."});
  else if(systemMemoryPercent>=80)warnings.push({level:"warning",message:"Systemspeicher ist hoch ausgelastet."});
  if(loadPerCore>=2)warnings.push({level:"critical",message:"CPU-Systemlast liegt deutlich über der Kernzahl."});
  else if(loadPerCore>=1)warnings.push({level:"warning",message:"CPU-Systemlast ist erhöht."});
  if(severe24h>0)warnings.push({level:"critical",message:severe24h+" schwere Serverfehler in den letzten 24 Stunden."});
  else if(errors24h>10)warnings.push({level:"warning",message:errors24h+" protokollierte Fehler in den letzten 24 Stunden."});
  res.set("Cache-Control","no-store").json({
   status:warnings.some(x=>x.level==="critical")?"critical":warnings.length?"warning":"healthy",
   checkedAt:new Date().toISOString(),uptimeSeconds:Math.floor(process.uptime()),
   cpu:{cores,loadAverage:load,loadPerCore},
   memory:{rss:mem.rss,heapUsed:mem.heapUsed,heapTotal:mem.heapTotal,total:os.totalmem(),free:os.freemem(),systemUsedPercent:systemMemoryPercent},
   errors:{last24Hours:errors24h,severeLast24Hours:severe24h,recent:latest.rows},
   warnings,
   note:"Systemlast und RAM sind Momentaufnahmen der Render-Instanz. Keine garantierte Kapazitäts- oder Ausfallvorhersage."
  });
 }catch(error){console.error("Admin health overview failed:",error.code||error.message);res.status(500).json({error:"Serverzustand konnte nicht geladen werden."})}
});

app.get("/api/admin/overview", auth, admin, async (_req,res)=>{
 try{
  const [users,chats,tickets,active,recentUsers,recentTickets]=await Promise.all([
   pool.query("SELECT COUNT(*) total,COUNT(*) FILTER (WHERE email_verified=TRUE) verified,COUNT(*) FILTER (WHERE email_verified=FALSE) unverified,COUNT(*) FILTER (WHERE created_at>=NOW()-INTERVAL '7 days') new_week FROM users"),
   pool.query("SELECT COUNT(*) total,COUNT(*) FILTER (WHERE updated_at>=NOW()-INTERVAL '24 hours') active_day FROM chats"),
   pool.query("SELECT COUNT(*) total,COUNT(*) FILTER (WHERE status='open') open,COUNT(*) FILTER (WHERE status='in_progress') in_progress,COUNT(*) FILTER (WHERE status='closed') closed FROM support_tickets"),
   pool.query("SELECT COUNT(*) n FROM user_message_usage WHERE usage_date=CURRENT_DATE AND message_count>0"),
   pool.query("SELECT id,username,role,created_at FROM users ORDER BY created_at DESC LIMIT 6"),
   pool.query("SELECT t.id,t.subject,t.status,t.updated_at,u.username FROM support_tickets t JOIN users u ON u.id=t.user_id ORDER BY t.updated_at DESC LIMIT 6")
  ]);
  const n=r=>Number(r.rows[0]?.n||0),u=users.rows[0],c=chats.rows[0],t=tickets.rows[0];
  res.set("Cache-Control","no-store").json({
   users:{total:Number(u.total),verified:Number(u.verified),unverified:Number(u.unverified),newLast7Days:Number(u.new_week)},
   chats:{total:Number(c.total),activeLast24Hours:Number(c.active_day)},
   tickets:{total:Number(t.total),open:Number(t.open),inProgress:Number(t.in_progress),closed:Number(t.closed)},
   activeUsersToday:n(active),recentUsers:recentUsers.rows,recentTickets:recentTickets.rows,
   checkedAt:new Date().toISOString()
  });
 }catch(error){console.error("Admin overview failed:",error.code||error.message);res.status(500).json({error:"Admin-Übersicht konnte nicht geladen werden."})}
});


// Admin-controlled global AI response style, stored in PostgreSQL.
const AI_RESPONSE_STYLES={balanced:"Antworte ausgewogen: zuerst die direkte Lösung, danach eine verständliche Erklärung und bei Bedarf ein Beispiel.",concise:"Antworte möglichst knapp und direkt. Nutze kurze Absätze und Listen, bleibe aber vollständig.",detailed:"Antworte ausführlicher und strukturiert. Erkläre Hintergründe, zeige Beispiele und nenne sinnvolle nächste Schritte."};
app.get("/api/admin/ai-settings",auth,admin,async(_req,res)=>{const q=await pool.query("SELECT value FROM app_settings WHERE key='ai_response_style'");const style=AI_RESPONSE_STYLES[q.rows[0]?.value]?q.rows[0].value:"balanced";res.set("Cache-Control","no-store").json({style,available:Object.keys(AI_RESPONSE_STYLES)});});
app.put("/api/admin/ai-settings",auth,admin,async(req,res)=>{const style=String(req.body.style||"");if(!AI_RESPONSE_STYLES[style])return res.status(400).json({error:"Ungültiger Antwortstil."});await pool.query("INSERT INTO app_settings(key,value) VALUES('ai_response_style',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[style]);res.json({ok:true,style});});
// Read-only AI operations panel. Reports configuration, not provider reachability.
app.get("/api/admin/ai-status",auth,admin,async(_req,res)=>{
 const styleResult=await pool.query("SELECT value FROM app_settings WHERE key='ai_response_style'");
 let databaseReady=false;try{await pool.query("SELECT 1");databaseReady=true}catch{}
 const model=String(process.env.GROQ_MODEL||"openai/gpt-oss-120b");
 const visionModel=String(process.env.GROQ_VISION_MODEL||"qwen/qwen3.8-27b");
 const providerKeyConfigured=!!String(process.env.GROQ_API_KEY||"").trim();
 res.set("Cache-Control","no-store").json({
  provider:"Groq",providerKeyConfigured,model,visionModel,
  visionKeyConfigured:providerKeyConfigured,
  responseStyle:AI_RESPONSE_STYLES[styleResult.rows[0]?.value]?styleResult.rows[0].value:"balanced",
  databaseReady,uptimeSeconds:Math.floor(process.uptime()),node:process.version,
  checkedAt:new Date().toISOString(),
  note:"Konfigurationsstatus; keine Live-Anfrage an den KI-Anbieter."
 });
});
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
    node:process.version,
    cpuCores:require("os").cpus().length,
    systemMemoryPercent:Number(((mem.rss / require("os").totalmem()) * 100).toFixed(2)),
    loadAveragePerCore:require("os").loadavg().map(v=>Number((v / Math.max(1,require("os").cpus().length)).toFixed(2)))
  });
});

async function checkDailyQuota(userId){const {rows}=await pool.query("INSERT INTO user_message_usage(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING usage_date,message_count,blocked_until",[userId]);let u=rows[0];const now=new Date();if(String(u.usage_date).slice(0,10)!==now.toISOString().slice(0,10)){const reset=await pool.query("UPDATE user_message_usage SET usage_date=CURRENT_DATE,message_count=0,blocked_until=NULL WHERE user_id=$1 RETURNING usage_date,message_count,blocked_until",[userId]);u=reset.rows[0]}if(u.blocked_until&&new Date(u.blocked_until)>now)return {blocked:true,until:u.blocked_until,count:u.message_count};if(u.blocked_until&&new Date(u.blocked_until)<=now){const resetAfterPause=await pool.query("UPDATE user_message_usage SET message_count=0,blocked_until=NULL WHERE user_id=$1 RETURNING usage_date,message_count,blocked_until",[userId]);u=resetAfterPause.rows[0]}const limitResult=await pool.query("SELECT value FROM app_settings WHERE key='daily_message_limit'");const dailyLimit=Math.max(1,Math.min(500,Number(limitResult.rows[0]?.value)||30));if(u.message_count>=dailyLimit){const until=new Date(now.getTime()+12*60*60*1000);await pool.query("UPDATE user_message_usage SET blocked_until=$1 WHERE user_id=$2",[until,userId]);return {blocked:true,until,count:u.message_count}}return {blocked:false,count:u.message_count,remaining:dailyLimit-u.message_count,limit:dailyLimit}}
async function incrementDailyQuota(userId){await pool.query("UPDATE user_message_usage SET message_count=message_count+1,blocked_until=CASE WHEN message_count+1>=(SELECT CAST(value AS INTEGER) FROM app_settings WHERE key='daily_message_limit') THEN CURRENT_TIMESTAMP+INTERVAL '12 hours' ELSE blocked_until END WHERE user_id=$1",[userId]);await pool.query("INSERT INTO daily_usage_stats(user_id,usage_date,message_count) VALUES($1,CURRENT_DATE,1) ON CONFLICT(user_id,usage_date) DO UPDATE SET message_count=daily_usage_stats.message_count+1",[userId])}
app.get("/api/admin/quota",auth,admin,async(_req,res)=>{const q=await pool.query("SELECT value FROM app_settings WHERE key=$1",["daily_message_limit"]);res.json({limit:Number(q.rows[0]?.value)||30})});
app.put("/api/admin/quota",auth,admin,async(req,res)=>{const limit=Math.max(1,Math.min(500,Math.floor(Number(req.body.limit)||30)));await pool.query("INSERT INTO app_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",["daily_message_limit",String(limit)]);res.json({ok:true,limit})});
app.get("/api/usage",auth,async(req,res)=>{if(req.user.role==="admin")return res.json({unlimited:true});const q=await checkDailyQuota(req.user.id);res.json({unlimited:false,count:q.count||0,remaining:q.remaining||0,limit:q.limit||30,blocked:q.blocked||false,until:q.until||null})});

/**
 * Public TILLBOT CORE research endpoint.
 * Uses the configured hosted model as an inference engine; this is not a separately trained foundation model.
 * Requests are rate-limited and never written to chat history or the database.
 */
app.get("/api/core/status", (_req, res) => {
  res.set("Cache-Control", "no-store").json({
    available: Boolean(process.env.GROQ_API_KEY),
    model: process.env.CORE_MODEL || "openai/gpt-oss-20b",
    provider: "Groq"
  });
});

/**
 * CORE Game Studio: generate a self-contained HTML5 game.
 * Generated code is previewed client-side in a sandboxed iframe with a restrictive CSP.
 */
const coreGameLimit = rateLimit({ windowMs: 10 * 60_000, limit: 2, standardHeaders: true, legacyHeaders: false, message: { error: "Spielerstellung ist gerade limitiert. Bitte in einigen Minuten erneut versuchen." } });
app.post("/api/core/game", coreGameLimit, async (_req, res, next) => {
  try { const m = await getMaintenance(); if (m.enabled) return res.status(503).json({ error: m.message }); next(); }
  catch { return res.status(503).json({ error: "Wartungsstatus konnte nicht geprüft werden." }); }
}, async (req, res) => {
  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt || prompt.length > 1200) return res.status(400).json({ error: "Bitte beschreibe dein Spiel mit maximal 1.200 Zeichen." });
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: "CORE Game Studio ist momentan nicht konfiguriert." });
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  res.on("close", () => { if (!res.writableEnded) controller.abort(); });
  try {
    const model = String(process.env.CORE_MODEL || "openai/gpt-oss-20b");
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", signal: controller.signal,
      headers: { Authorization: "Bearer " + process.env.GROQ_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are TILLBOT CORE 3D Game Studio, a senior real-time 3D game engineer. Return ONLY one complete valid HTML5 document, no Markdown fences. Build a genuinely three-dimensional, playable WebGL game using the browser WebGL API directly (no libraries, no imports, no CDN, no external files, no network). Do NOT fake 3D with a 2D canvas: create a WebGL context, perspective projection, depth buffer, shaders, vertex/index buffers, camera transforms, lighting and actual 3D geometry. Use compact inline GLSL shaders and JavaScript. Create an original polished vertical slice with a real 3D world, terrain/floor, varied 3D objects, sky/background, camera movement, player controls, collision or interaction, objective, HUD, start/pause/restart flow, progression and responsive keyboard/touch input. Use procedural geometry and materials, atmospheric lighting, shadows if robust, fog, particles and depth effects where feasible. Prioritize a stable 3D scene and fun, complete gameplay over excessive code. Include graceful WebGL unsupported fallback. Use no external libraries, remote assets, imports, analytics, cookies, localStorage, service workers, iframe, object, embed, forms, external URLs, fetch, XHR or network APIs. Keep output compact enough to fit in one response and ensure all functions are defined. Use original fictional settings/assets only; never recreate copyrighted game maps, characters, logos, storylines or assets. If a commercial game is referenced, use broad genre conventions only and create a distinct world. Keep violence stylized and non-graphic; never include real-world tactical instructions. Output a complete <!doctype html> document." },
          { role: "user", content: "Create an original playable HTML5 game from this brief:\n" + prompt }
        ],
        max_completion_tokens: 6000,
        temperature: 0.65,
        stream: false
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("CORE game provider error:", response.status, data.error?.code || "provider_error");
      return res.status(502).json({ error: "CORE konnte das Spiel gerade nicht erzeugen. Bitte versuche es später erneut." });
    }
    let html = String(data.choices?.[0]?.message?.content || "").trim();
    html = html.replace(/^\uFEFF/, "").replace(/^\x60{3}(?:html)?\s*/i, "").replace(/\s*\x60{3}$/i, "").trim();
    if (!/^<!doctype html/i.test(html) || !/<html[\s>]/i.test(html) || !/<\/html>/i.test(html) || html.length > 95000) {
      return res.status(502).json({ error: "CORE hat keinen gültigen, kompakten HTML5-Spielcode geliefert. Bitte versuche es mit einer etwas einfacheren Beschreibung." });
    }
    res.set("Cache-Control", "no-store").json({ html, model: "TILLBOT CORE Game Studio", elapsedMs: Date.now() - startedAt });
  } catch (error) {
    console.error("CORE game request failed:", error.name || "request_error");
    res.status(504).json({ error: error.name === "AbortError" ? "Die Spielerstellung hat zu lange gedauert. Bitte versuche es mit einer kleineren Spielidee erneut." : "CORE Game Studio ist momentan nicht erreichbar." });
  } finally { clearTimeout(timeout); }
});


app.post("/api/core/game/package", rateLimit({ windowMs: 10 * 60_000, limit: 5, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
  const html = String(req.body?.html || "");
  if (!/^<!doctype html/i.test(html) || !html.toLowerCase().includes("<html") || !html.toLowerCase().includes("</html>") || html.length > 95000) return res.status(400).json({ error: "Ungültiges Spielprojekt. Bitte erstelle das Spiel erneut." });
  const quote = String.fromCharCode(39);
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src ' + quote + 'none' + quote + '; script-src ' + quote + 'unsafe-inline' + quote + '; style-src ' + quote + 'unsafe-inline' + quote + '; img-src data: blob:; font-src data:; media-src data: blob:; connect-src ' + quote + 'none' + quote + '; object-src ' + quote + 'none' + quote + '; base-uri ' + quote + 'none' + quote + '; form-action ' + quote + 'none' + quote + '">';
  const safeHtml = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, match => match + csp) : html;
  const projectPackage = { name: "tillbot-ai-game", version: "1.0.0", private: true, description: "Eigenes, mit TILLBOT CORE erstelltes Offline-Spiel", main: "main.cjs", scripts: { "build:win": "electron-builder --win portable --x64" }, devDependencies: { electron: "^39.0.0", "electron-builder": "^26.0.12" }, build: { appId: "de.tillbot.aigame", productName: "Mein KI-Spiel", files: ["index.html", "main.cjs", "package.json"], directories: { output: "dist" }, win: { target: ["portable"], artifactName: "Mein-KI-Spiel-${version}-${arch}.${ext}" } } };
  const readme = "WINDOWS-BUILD\n\n1. ZIP unter Windows entpacken.\n2. Node.js LTS von https://nodejs.org installieren.\n3. BUILD-WINDOWS.bat doppelklicken.\n4. Die portable EXE liegt anschließend im Ordner dist.\n\nDer Build läuft auf deinem Windows-PC. Dieses Paket ist noch nicht die fertige EXE. Das Spiel läuft offline; Electron deaktiviert Node-Integration und blockiert externe Netzwerkaufrufe.\n";
  res.set({ "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="tillbot-windows-game-project.zip"', "Cache-Control": "no-store" });
  const archive = archiver("zip", { zlib: { level: 8 } });
  archive.on("error", error => { console.error("Game project archive failed:", error.message); if (!res.headersSent) res.status(500).end("Projekt konnte nicht gepackt werden."); else res.destroy(error); });
  archive.pipe(res);
  archive.append(safeHtml, { name: "index.html" });
  archive.append("const { app, BrowserWindow, session } = require(\"electron\");\nconst path = require(\"path\");\nfunction createWindow() {\n  const win = new BrowserWindow({ width: 1440, height: 900, minWidth: 900, minHeight: 600, title: \"Mein KI-Spiel\", backgroundColor: \"#090b12\", webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });\n  win.webContents.setWindowOpenHandler(() => ({ action: \"deny\" }));\n  win.webContents.on(\"will-navigate\", (event, url) => { if (!url.startsWith(\"file://\")) event.preventDefault(); });\n  win.loadFile(path.join(__dirname, \"index.html\"));\n}\napp.whenReady().then(() => { session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false)); session.defaultSession.webRequest.onBeforeRequest({ urls: [\"http://*/*\", \"https://*/*\"] }, (_details, callback) => callback({ cancel: true })); createWindow(); app.on(\"activate\", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });\napp.on(\"window-all-closed\", () => { if (process.platform !== \"darwin\") app.quit(); });", { name: "main.cjs" });
  archive.append(JSON.stringify(projectPackage, null, 2), { name: "package.json" });
  archive.append("@echo off\r\nchcp 65001 >nul\r\ntitle TILLBOT - Windows-Spiel bauen\r\necho TILLBOT CORE - Windows-Spiel erstellen\r\nwhere node >nul 2>nul\r\nif errorlevel 1 ( echo Bitte Node.js LTS von https://nodejs.org installieren. & pause & exit /b 1 )\r\necho Installiere Build-Abhaengigkeiten ...\r\ncall npm install\r\nif errorlevel 1 goto error\r\necho Erstelle portable Windows-EXE ...\r\ncall npm run build:win\r\nif errorlevel 1 goto error\r\necho Fertig! Die EXE liegt im Ordner dist.\r\nexplorer dist\r\npause\r\nexit /b 0\r\n:error\r\necho Build fehlgeschlagen. Pruefe die Fehlermeldung oben.\r\npause\r\nexit /b 1", { name: "BUILD-WINDOWS.bat" });
  archive.append(readme, { name: "README-WINDOWS.txt" });
  archive.finalize();
});

app.post("/api/core/chat", rateLimit({ windowMs: 60_000, limit: 8, standardHeaders: true, legacyHeaders: false, message: { error: "CORE ist gerade stark ausgelastet. Bitte eine Minute warten." } }), async (_req, res, next) => { try { const m = await getMaintenance(); if (m.enabled) return res.status(503).json({ error: m.message }); next(); } catch { return res.status(503).json({ error: "Wartungsstatus konnte nicht geprüft werden." }); } }, async (req, res) => {
  const message = String(req.body?.message || "").trim();
  if (!message || message.length > 2000) return res.status(400).json({ error: "Bitte gib eine Nachricht mit maximal 2.000 Zeichen ein." });
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: "CORE ist momentan nicht verfügbar. Der Modellserver ist nicht konfiguriert." });
  // Accept only short, plain-text conversational context. Never trust client-supplied system messages.
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8).flatMap(item => {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string") return [];
    const content = item.content.trim().slice(0, 2000);
    return content ? [{ role: item.role, content }] : [];
  }) : [];
  const answerMode = ["short", "balanced", "detailed"].includes(req.body?.answerMode) ? req.body.answerMode : "balanced";
  const answerGuidance = { short: "Antworte sehr knapp und auf den Punkt, möglichst in wenigen Sätzen.", balanced: "Halte Antworten standardmäßig kompakt, erweitere sie bei komplexen Fragen.", detailed: "Antworte ausführlich und strukturiert mit Erklärungen, Beispielen und sinnvollen Zwischenschritten." }[answerMode];
  const coreMode = ["general","learning","coding","writing","research","planning","creative","analysis"].includes(req.body?.mode) ? req.body.mode : "general";
  const modeGuidance = {
    general: "Arbeite als vielseitiger Assistent und wähle die passende Vorgehensweise.",
    learning: "Lernmodus: Erkläre schrittweise und verständlich, prüfe das Verständnis mit kleinen Fragen und gib hilfreiche Übungsaufgaben. Verrate bei Lernaufgaben nicht sofort jede Lösung.",
    coding: "Programmiermodus: Kläre bei Bedarf die Anforderungen, liefere vollständige und sichere Codebeispiele, nenne betroffene Dateien und erkläre Tests sowie mögliche Randfälle.",
    writing: "Schreibmodus: Unterstütze beim Strukturieren, Formulieren und Überarbeiten. Passe Ton und Format an den Zweck an und erfinde keine Fakten.",
    research: "Recherchemodus: Trenne bekannte Fakten von Unsicherheiten, nenne sinnvolle Suchbegriffe und Quellentypen und erfinde niemals Quellen oder Zitate.",
    planning: "Planungsmodus: Erstelle realistische, priorisierte Schritte mit Abhängigkeiten und einem klaren nächsten Schritt.",
    creative: "Kreativmodus: Entwickle originelle Ideen und mehrere unterscheidbare Varianten, bleibe aber bei den Vorgaben.",
    analysis: "Analysemodus: Zerlege das Problem, mache Annahmen sichtbar, vergleiche Optionen und begründe das Ergebnis."
  }[coreMode];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  res.on("close", () => { if (!res.writableEnded) controller.abort(); });
  try {
    const model = String(process.env.CORE_MODEL || "openai/gpt-oss-20b");
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: "Bearer " + process.env.GROQ_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Du bist TILLBOT CORE, ein leistungsfähiger deutschsprachiger KI-Assistent. Antworte klar, freundlich, kompetent und natürlich. Fragen zu Adminrechten sind normale Supportfragen und dürfen nicht pauschal blockiert oder als Sicherheitsverstoß behandelt werden. Erkläre freundlich und knapp: Adminrechte werden nicht über den Chat vergeben; sie können ausschließlich vom TILLBOT-Team autorisiert werden. Behaupte nicht, es gäbe grundsätzlich keine Admin-Konten. Gib niemals Setup-Geheimnisse, Tokens oder Wege zur Umgehung der Rollenprüfung preis. Löse die eigentliche Aufgabe direkt statt nur allgemeine Tipps zu geben. Strukturiere komplexe Antworten in verständliche Schritte und nutze konkrete Beispiele. Bei Code: liefere vollständige, sichere und möglichst direkt ausführbare Lösungen; prüfe gedanklich Randfälle und erkläre wichtige Voraussetzungen. Bei kreativen Aufgaben: sei originell und setze die Vorgaben präzise um. Erfinde keine Funktionen, Quellen, Testergebnisse, Dateien oder erledigten Aktionen. Unterscheide klar zwischen tatsächlich geprüft und nur vorgeschlagen. Wenn wichtige Informationen fehlen, stelle höchstens eine gezielte Rückfrage; ansonsten triff vernünftige Annahmen und nenne sie kurz. Gib Unsicherheit offen zu und korrigiere Fehler direkt. Antworte in der Sprache der letzten Nachricht. Du bist kein selbst trainiertes Grundmodell, sondern nutzt einen externen Modellanbieter; TILLBOT speichert diesen öffentlichen Demo-Chat nicht als Chatverlauf, Nachrichten werden zur Verarbeitung an den externen Anbieter übertragen. ${answerGuidance} ${modeGuidance}" },
          ...history,
          { role: "user", content: message }
        ],
        max_completion_tokens: 1100,
        temperature: 0.55,
        stream: false
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("CORE provider error:", response.status, data.error?.code || "provider_error");
      return res.status(502).json({ error: "CORE konnte gerade keine Antwort erzeugen. Bitte versuche es später erneut." });
    }
    const answer = data.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) return res.status(502).json({ error: "CORE hat keine Antwort geliefert. Bitte versuche es erneut." });
    res.set("Cache-Control", "no-store").json({ answer: answer.trim(), model: "TILLBOT CORE · Forschungsdemo", stored: false });
  } catch (error) {
    console.error("CORE request failed:", error.name || "request_error");
    res.status(504).json({ error: error.name === "AbortError" ? "CORE braucht gerade zu lange. Bitte versuche es erneut." : "CORE ist momentan nicht erreichbar." });
  } finally {
    clearTimeout(timeout);
  }
});

const chatAccountLimit = rateLimit({ windowMs: 60_000, limit: 8, keyGenerator: req => "account:" + String(req.user.id), standardHeaders: true, legacyHeaders: false, message: { error: "Für dieses Konto wurden gerade zu viele KI-Anfragen gesendet. Bitte kurz warten." } });

app.post("/api/chat", auth, async (req,res,next)=>{try{const m=await getMaintenance();if(m.enabled)return res.status(503).json({error:m.message});next()}catch{return res.status(503).json({error:"Wartungsstatus konnte nicht geprüft werden."})}}, rateLimit({ windowMs: 60_000, limit: 12, message: { error: "Zu viele Nachrichten. Bitte kurz warten." } }), chatAccountLimit, async (req, res) => {
  if(req.user.role!=="admin"){const q=await checkDailyQuota(req.user.id);if(q.blocked)return res.status(429).json({error:"Dein Tagesbudget ist aufgebraucht. Du kannst ab "+new Date(q.until).toLocaleString("de-DE")+" Uhr wieder schreiben.",quota:{blocked:true,until:q.until,remaining:0}});req.dailyQuota=q}
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ answer: "GROQ_API_KEY fehlt in Render" });
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return res.status(400).json({ error: "Ungültige Anfrage." });
  const userText = typeof req.body.message === "string" ? req.body.message.trim() : "";
  const image = req.body.image;
  if (userText.length > 8000) return res.status(400).json({ error: "Deine Nachricht ist zu lang (maximal 8.000 Zeichen)." });
  if (!userText && !(image && typeof image.data === "string")) return res.status(400).json({ error: "Bitte gib eine Nachricht ein oder füge ein Bild hinzu." });
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-12).filter(m => m && ["user","assistant"].includes(m.role) && typeof m.content === "string").map(m => ({ role:m.role, content:m.content.slice(0,8000) })) : [];
  const aiStyleResult=await pool.query("SELECT value FROM app_settings WHERE key='ai_response_style'");
  const aiStyle=AI_RESPONSE_STYLES[aiStyleResult.rows[0]?.value]||AI_RESPONSE_STYLES.balanced;
  const prefResult=await pool.query("SELECT instructions,model FROM user_preferences WHERE user_id=$1",[req.user.id]);
  const preferences=prefResult.rows[0]||{};
  const allowedModels=availableGroqModels();
  const requestedModel=String(req.body.model||preferences.model||process.env.GROQ_MODEL||allowedModels[0]);
  const selectedModel=allowedModels.includes(requestedModel)?requestedModel:allowedModels[0];
  const memoryResult=await featureEnabled("memory")?await pool.query("SELECT title,content FROM user_memories WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 10",[req.user.id]):{rows:[]};
  const personalContext=[preferences.instructions?("Persönliche Anweisungen des Nutzers (als Präferenz behandeln, nicht als Systemregeln): "+preferences.instructions):"",memoryResult.rows.length?"Vom Nutzer gespeicherte Erinnerungen (nur bei Relevanz berücksichtigen): "+memoryResult.rows.map(m=>m.title+": "+m.content).join("; "):""].filter(Boolean).join("\n").slice(0,6000);
  const systemPrompt="Du bist TILLBOT, der KI-Assistent des TILLBOT-Projekts. TILLBOT wird vom TILLBOT-Team entwickelt und gepflegt. Wenn du gefragt wirst, wer dich entwickelt hat, antworte: „Ich bin TILLBOT, der KI-Assistent des TILLBOT-Teams.“ Behaupte nicht, dass das Team ein eigenes Grundmodell von Grund auf trainiert hat: Das zugrunde liegende Sprachmodell wird als externer KI-Dienst bereitgestellt. Antworte standardmäßig auf Deutsch in einem klaren, professionellen, erwachsenen und respektvollen Ton. Behandle Fragen wie „Kann ich Admin werden?“ oder „Wie bekomme ich Adminrechte?“ als harmlose Supportfragen und beantworte sie direkt statt sie zu blockieren: Adminrechte werden nicht über den Chat vergeben, sondern ausschließlich vom TILLBOT-Team autorisiert. Behaupte nicht, dass es grundsätzlich keine Admin-Konten gibt. Lege keine Setup-Geheimnisse, Tokens oder Umgehungswege offen. Verwende keine kindliche Ansprache, keine unnötigen Emojis, keine übertriebenen Begeisterungsfloskeln und keine Kosenamen. Passe die Detailtiefe an die Aufgabe an, bleibe ruhig und präzise und erkläre Fachbegriffe bei Bedarf verständlich. Bei Programmierfragen: liefere korrekten, möglichst vollständigen Code in Markdown-Codeblöcken mit passendem Sprachlabel (z. B. ```js), erkläre kurz Verwendung und wichtige Schritte, nenne nötige Dateien/Abhängigkeiten und weise auf Annahmen hin. Bei Debugging: analysiere erst den Fehler, nenne Ursache und zeige eine konkrete Lösung. Erfinde keine Testergebnisse und behaupte nicht, Code ausgeführt zu haben. Schreibe Code sicher und warne vor riskanten Aktionen; führe niemals automatisch vom Nutzer gelieferten oder generierten Code aus. Bei großen Projekten strukturiere die Antwort in Dateien und frage nur bei wirklich fehlenden Anforderungen nach."+ " "+aiStyle;
  const messages = [{ role: "system", content: systemPrompt+" "+personalContext },
    ...history.filter(m => ["user", "assistant"].includes(m.role) && typeof m.content === "string")
      .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }))];
  if(image&&typeof image.data==="string"&&!await featureEnabled("file_analysis"))return res.status(403).json({answer:"Datei- und Bildanalyse ist derzeit deaktiviert."});
  if (image && typeof image.data === "string") {
    if (!["image/jpeg", "image/png", "image/webp"].includes(image.mime) || image.data.length > 2_500_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) {
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
      body: JSON.stringify({ model: (image ? (process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b") : selectedModel), messages, max_completion_tokens: 800, temperature: 0.7, stream:!!req.body.stream })
    });
    if(req.body.stream&&response.ok){res.status(200).set({"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-cache, no-transform","Connection":"keep-alive","X-Accel-Buffering":"no"});res.flushHeaders?.();const reader=response.body.getReader(),decoder=new TextDecoder();let pending="",full="";while(true){const {done,value}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});const lines=pending.split("\n");pending=lines.pop()||"";for(const line of lines){const dataLine=line.trim();if(!dataLine.startsWith("data:"))continue;const raw=dataLine.slice(5).trim();if(raw==="[DONE]")continue;try{const packet=JSON.parse(raw),delta=packet.choices?.[0]?.delta?.content;if(typeof delta==="string"&&delta){full+=delta;res.write("data: "+JSON.stringify({delta})+"\n\n")}}catch{}}}if(req.user.role!=="admin"&&req.dailyQuota)await incrementDailyQuota(req.user.id);res.write("data: "+JSON.stringify({done:true,quota:req.user.role==="admin"?{unlimited:true}:undefined})+"\n\n");return res.end()}
    const data = await response.json();
    if (!response.ok) return res.status(502).json({ answer: "Groq Fehler: " + (data.error?.message || response.status) });
    if(req.user.role!=="admin"&&req.dailyQuota)await incrementDailyQuota(req.user.id);
    res.json({ answer: data.choices?.[0]?.message?.content || "Keine Antwort",quota:req.user.role==="admin"?{unlimited:true}:undefined });
  } catch (error) {
    console.error("Chat API error:", error);
    pool.query("INSERT INTO system_error_logs(level,source,message) VALUES($1,$2,$3)",["error","chat",String(error.message||"Chat-Fehler").slice(0,500)]).catch(()=>{});
    res.status(500).json({ answer: error.name === "AbortError" ? "KI-Anfrage dauerte zu lange" : "KI-Serverfehler" });
  } finally {
    clearTimeout(timeout);
  }
});

app.use((error, _req, res, _next) => {
  console.error("Express error:", error);
  pool.query("INSERT INTO system_error_logs(level,source,message) VALUES($1,$2,$3)",["error","express",String(error.message||"Serverfehler").slice(0,500)]).catch(()=>{});
  res.status(500).json({ error: "Interner Serverfehler" });
});

const PORT = Number(process.env.PORT) || 3000;
initDatabase().then(() => { const server = app.listen(PORT, "0.0.0.0", () => console.log(`TILLBOT bereit auf 0.0.0.0:${PORT}`));
server.on("error", error => { console.error("Port/Server error:", error); process.exit(1); }); }).catch(error => { console.error("PostgreSQL Init fehlgeschlagen:", error); process.exit(1); });
