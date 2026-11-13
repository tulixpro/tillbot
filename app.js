
const API = "https://tillbot.onrender.com";

let busy = false;
let conversations = JSON.parse(localStorage.getItem("tillbot-pages-chats") || "[]");
let active = null;

const $ = id => document.getElementById(id);

function persist() {
  localStorage.setItem("tillbot-pages-chats", JSON.stringify(conversations));
  historyUI();
}

function historyUI() {
  const h = $("history");
  h.innerHTML = "";

  conversations.forEach(c => {
    const b = document.createElement("button");
    b.textContent = c.title;
    b.onclick = () => {
      active = c;
      render();
    };
    h.append(b);
  });
}

function render() {
  const c = $("chat");
  c.innerHTML = "";

  if (!active || !active.messages.length) {
    c.innerHTML = `
      <div class="welcome">
        <div class="cloud">☁</div>
        <h1>Hallo! Ich bin TILLBOT.</h1>
        <p>Your AI. Your World.</p>
        <p class="muted">Dein Chat ist mit dem TILLBOT-Server verbunden.</p>
        <div class="status">TILLBOT Server online ✓</div>
      </div>
    `;
    return;
  }

  active.messages.forEach(m => {
    const d = document.createElement("div");
    d.className = "bubble " + (m.role === "user" ? "user" : "bot");
    d.textContent = m.content;
    c.append(d);
  });

  c.scrollTop = c.scrollHeight;
}

async function send() {
  if (busy) return;

  const text = $("prompt").value.trim();
  if (!text) return;

  if (!active) {
    active = {
      id: Date.now(),
      title: text.slice(0, 32),
      messages: []
    };
    conversations.unshift(active);
  }

  active.messages.push({ role: "user", content: text });
  $("prompt").value = "";

  persist();
  render();

  busy = true;

  const wait = document.createElement("div");
  wait.className = "bubble bot";
  wait.textContent = "TILLBOT denkt …";
  $("chat").append(wait);

  try {
    const response = await fetch(API + "/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: text,
        history: active.messages
      })
    });

    if (!response.ok) {
      throw new Error("Server Fehler: " + response.status);
    }

    const data = await response.json();

    active.messages.push({
      role: "assistant",
      content: data.answer || "Keine Antwort erhalten."
    });

  } catch (e) {
    active.messages.push({
      role: "assistant",
      content: "Verbindungsfehler: " + e.message
    });
  } finally {
    busy = false;
    persist();
    render();
  }
}

$("send").onclick = send;

$("prompt").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

$("newChat").onclick = () => {
  active = null;
  render();
};

$("theme").onclick = () =>
  document.body.classList.toggle("dark");

$("menu").onclick = () => {
  $("sidebar").classList.toggle("open");
  document.querySelector("aside").classList.toggle("open");
};

$("admin").onclick = () =>
  $("adminDialog").showModal();

$("closeAdmin").onclick = () =>
  $("adminDialog").close();

historyUI();
render();

