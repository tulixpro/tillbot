# TILLBOT 2.0

TILLBOT is a browser-based AI workspace with a static GitHub Pages frontend and an Express/PostgreSQL backend.

## Architecture

- **Frontend:** `index.html`, `style.css`, `app.js`, PWA manifest and service worker; hosted on GitHub Pages.
- **Backend:** `server.js` (Express 5) and `database.js` (PostgreSQL); deploy the Node service on Render or another Node host.
- **AI:** Chat requests go through a server-side multi-provider adapter. Groq and Cloudflare Workers AI are supported, with optional Google Gemini as a third provider. Provider keys stay on the server and are never sent to the browser.
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
- `GROQ_API_KEY` – Groq API key (required when Groq is used as primary or fallback).
- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` – optional Cloudflare Workers AI credentials.
- `GEMINI_API_KEY` – optional Google Gemini API key. Gemini is disabled unless both `GEMINI_API_ENABLED=true` and `GEMINI_FREE_TIER_DATA_ACK=true` are set.
- `AI_PROVIDER` – first-choice provider: `groq` (default), `cloudflare` or `gemini`.
- `AI_FALLBACK_PROVIDER` – optional second provider. Defaults to Cloudflare when Groq is primary, otherwise Groq.
- `AI_PROVIDER_ORDER` – optional comma-separated ordered provider list, e.g. `groq,cloudflare,gemini`. Only configured and explicitly enabled providers are attempted.
- `FRONTEND_ORIGIN` – allowed frontend origin, e.g. `https://tulixpro.github.io`.
- `ADMIN_USERNAME` and `ADMIN_SETUP_SECRET` – one-time admin bootstrap configuration. Use a strong setup secret and remove/rotate it after setup where operationally possible.

Optional:

- `GROQ_MODEL` / `GROQ_VISION_MODEL` – optional Groq model overrides.
- `CLOUDFLARE_MODEL` / `CLOUDFLARE_VISION_MODEL` – optional Cloudflare model overrides.
- `GEMINI_MODEL` / `GEMINI_VISION_MODEL` – optional Gemini model overrides.
- `MAINTENANCE_MESSAGE` – fallback maintenance notice.
- `MAINTENANCE_ENABLED` is not read directly; maintenance is controlled via the admin panel/database setting.

## Current features

- Login and registration with server-side rate limits and a honeypot anti-bot check; account/session handling.
- Persistent chat history, rename/delete chats, streaming AI responses.
- 14 prompt shortcuts (Lerncoach, Text verbessern, Zusammenfassen, Kreativmodus, Codehilfe, Quiz, Übersetzen, Planer, Einfach erklären, Brainstorm, Story, Prüfungstraining, E-Mail, Debugger). These are prompt templates, not separate AI models.
- Image attachment for **image analysis** (not image generation).
- Browser speech recognition for dictation where supported, and speech synthesis for reading responses.
- Chat export, PWA install prompt, themes, workspace preferences and customizable home screen.
- Support tickets, admin dashboard, quota/maintenance controls and a configuration security audit.

## Limits & privacy

- Chat abuse protection uses shared PostgreSQL counters: at most 6 AI requests per account per minute (10 for admins) and 15 per IP/network per minute. IP identifiers are HMAC-hashed before storage; old counters are periodically cleaned up. The daily account quota still applies separately. These controls reduce automated bursts but cannot guarantee that all abuse is prevented.

- AI responses require an internet connection, backend, database and at least one configured provider. The backend can retry with the configured fallback after provider rate limits (HTTP 429), temporary server errors or connection/time-out failures. It does not silently switch to an unconfigured or paid provider. Both providers have their own limits, and a fallback can also be unavailable; this improves resilience but does not guarantee uninterrupted service.
- Cloudflare Workers AI has a limited free allowance of 10,000 Neurons per day; exceeding it returns a rate-limit error. Groq's limits vary by model and account and can include requests and token limits. Check the provider dashboards for the current account-specific limits.
- The small UI quick actions guide the selected external AI model through prompts; they do not create independent models or guarantee specialized behavior.
- Speech recognition and speech synthesis depend on browser/device support.
- Uploaded images and chat content are sent to the backend/AI provider to answer the request. Chat histories and account data are stored in PostgreSQL. Do not submit passwords, private documents or sensitive personal data.
- The admin security audit checks selected configuration/database conditions; it is **not** a penetration test or guarantee of security. GitHub Actions runs JavaScript syntax checks and an npm audit of production dependencies; Dependabot checks dependencies weekly.
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
