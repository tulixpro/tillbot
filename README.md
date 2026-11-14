# TILLBOT 2.0

TILLBOT is a browser-based AI workspace with a static GitHub Pages frontend and an Express/PostgreSQL backend.

## Architecture

- **Frontend:** `index.html`, `style.css`, `app.js`, PWA manifest and service worker; hosted on GitHub Pages.
- **Backend:** `server.js` (Express 5) and `database.js` (PostgreSQL); deploy the Node service on Render or another Node host.
- **AI:** Chat requests go from the backend to Groq's OpenAI-compatible API. The browser never receives the Groq API key.
- **Authentication:** Username/password accounts, bcrypt password hashes and JWT sessions (7 days).
- **Data:** Accounts, chat history, support tickets, usage counters and app settings are stored in PostgreSQL.
- **Desktop:** Electron entry point is `windows/main.cjs`; `npm run desktop` starts the desktop shell.

## Frontend deployment (GitHub Pages)

1. Keep the repository on the `main` branch.
2. In GitHub → Settings → Pages, select **Deploy from a branch**, `main`, folder `/`.
3. The site is served at `https://tulixpro.github.io/tillbot/`.
4. After a frontend commit, allow Pages to publish and refresh the site. If an old UI remains, close/reopen the PWA or clear its site cache; the service worker cache version is in `sw.js`.

## Backend deployment

Deploy `server.js` with Node.js and install dependencies using `npm install`. The service listens on `process.env.PORT` (fallback 3000).

Required environment variables (set in the hosting provider's secret/environment settings, never in frontend files):

- `DATABASE_URL` – PostgreSQL connection URL.
- `JWT_SECRET` – stable random secret, at least 32 characters. Changing it invalidates existing sessions.
- `GROQ_API_KEY` – key for the AI API.
- `TURNSTILE_SECRET_KEY` – Cloudflare Turnstile secret; registration/login require successful server-side verification.
- `FRONTEND_ORIGIN` – allowed frontend origin, e.g. `https://tulixpro.github.io`.
- `ADMIN_USERNAME` and `ADMIN_SETUP_SECRET` – one-time admin bootstrap configuration. Use a strong setup secret and remove/rotate it after setup where operationally possible.

Optional:

- `GROQ_MODEL` – text model (default configured in `server.js`).
- `GROQ_VISION_MODEL` – vision model (default configured in `server.js`).
- `MAINTENANCE_MESSAGE` – fallback maintenance notice.
- `MAINTENANCE_ENABLED` is not read directly; maintenance is controlled via the admin panel/database setting.

## Current features

- Login and registration with CAPTCHA, account/session handling.
- Persistent chat history, rename/delete chats, streaming AI responses.
- 14 prompt shortcuts (Lerncoach, Text verbessern, Zusammenfassen, Kreativmodus, Codehilfe, Quiz, Übersetzen, Planer, Einfach erklären, Brainstorm, Story, Prüfungstraining, E-Mail, Debugger). These are prompt templates, not separate AI models.
- Image attachment for **image analysis** (not image generation).
- Browser speech recognition for dictation where supported, and speech synthesis for reading responses.
- Chat export, PWA install prompt, themes, workspace preferences and customizable home screen.
- Support tickets, admin dashboard, quota/maintenance controls and a configuration security audit.

## Limits & privacy

- AI responses require an internet connection and a working backend, database and Groq API key. GitHub Pages alone cannot run the backend.
- The small UI quick actions guide the same AI model through prompts; they do not create independent tools or guarantee specialized behavior.
- Speech recognition and speech synthesis depend on browser/device support.
- Uploaded images and chat content are sent to the backend/AI provider to answer the request. Chat histories and account data are stored in PostgreSQL. Do not submit passwords, private documents or sensitive personal data.
- The admin security audit checks selected configuration/database conditions; it is **not** a penetration test or guarantee of security.
- Service-worker caching supports the app shell, not offline AI generation.

## Local development

```bash
npm install
npm start
```

Set the required backend environment variables first. For the Electron shell:

```bash
npm run desktop
```

The frontend is a static site; the API URL is currently configured in `app.js`.
