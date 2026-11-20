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

## Public CORE demo

The public TILLBOT CORE research demo is available at `https://tulixpro.github.io/tillbot/core-demo.html` without an account. It calls the backend's rate-limited `/api/core/chat` endpoint and uses the configured Groq-hosted model (default `openai/gpt-oss-20b`) as its inference engine. CORE is not a separately trained foundation model. Public demo prompts are not stored as chat history by TILLBOT, but are transmitted to the external model provider for inference. Set `CORE_MODEL` optionally to choose a supported Groq model.

## Backend deployment

Deploy `server.js` with Node.js and install dependencies using `npm install`. The service listens on `process.env.PORT` (fallback 3000).

Required environment variables (set in the hosting provider's secret/environment settings, never in frontend files):

- `DATABASE_URL` – PostgreSQL connection URL.
- `JWT_SECRET` – stable random secret, at least 32 characters. Changing it invalidates existing sessions.
- `GROQ_API_KEY` – key for the AI API.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`, `SMTP_USER`, `SMTP_PASS` – optional SMTP configuration for the admin test-mail tool. Keep credentials in Render environment variables, never in GitHub. Port 465 normally uses `SMTP_SECURE=true`; port 587 normally uses `false`.
- `FRONTEND_ORIGIN` – allowed frontend origin, e.g. `https://tulixpro.github.io`.
- `FRONTEND_URL` – full frontend base URL used to build verification/reset links, e.g. `https://tulixpro.github.io/tillbot/`.
- SMTP must be configured for new registrations, verification emails and password recovery. New accounts can sign in only after verifying their address. Existing legacy accounts without an email remain able to sign in.
- `ADMIN_USERNAME` and `ADMIN_SETUP_SECRET` – one-time admin bootstrap configuration. Use a strong setup secret and remove/rotate it after setup where operationally possible.

Optional:

- `GROQ_MODEL` – text model (default configured in `server.js`).
- `GROQ_VISION_MODEL` – vision model (default configured in `server.js`).
- `MAINTENANCE_MESSAGE` – fallback maintenance notice.
- `MAINTENANCE_ENABLED` is not read directly; maintenance is controlled via the admin panel/database setting.

## Current features

- Login with server-side rate limits and a honeypot anti-bot check; new registration requires email verification. Single-use, expiring email tokens support verification and password recovery.
- Persistent chat history, rename/delete chats, streaming AI responses.
- 14 prompt shortcuts (Lerncoach, Text verbessern, Zusammenfassen, Kreativmodus, Codehilfe, Quiz, Übersetzen, Planer, Einfach erklären, Brainstorm, Story, Prüfungstraining, E-Mail, Debugger). These are prompt templates, not separate AI models.
- Image attachment for **image analysis** (not image generation).
- Browser speech recognition for dictation where supported, and speech synthesis for reading responses.
- Chat export, PWA install prompt, themes, workspace preferences and customizable home screen.
- Support tickets, admin dashboard, quota/maintenance controls, configuration security audit and an admin-only SMTP connection/test-mail tool.

## Limits & privacy

- AI responses require an internet connection and a working backend, database and Groq API key. GitHub Pages alone cannot run the backend.
- The small UI quick actions guide the same AI model through prompts; they do not create independent tools or guarantee specialized behavior.
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


## TILLBOT Studio (separate installierbare Admin-App)

- Open `https://tulixpro.github.io/tillbot/studio.html` after signing in to TILLBOT with an administrator account.
- The Studio is a separate responsive PWA with aggregate server metrics, AI configuration status, global AI response-style control, configuration security checks, local appearance settings, module visibility, and JSON settings backup/restore.
- Install on Chrome/Edge from the browser's install control. On iOS, open in Safari and use Share → Add to Home Screen. Installation does not bypass authentication; an admin session and internet connection are still required.
- Studio preferences are stored locally in the browser. API secrets are never displayed. AI status reports configuration only and does not run a provider health/billing test.


### TILLBOT Studio 4.0
- Eigenständige Admin-PWA unter `/studio.html` mit eigenem hellen Workspace-Design; die öffentliche Chat-Oberfläche bleibt unverändert.
- Installationsdiagnose, eigenständige Manifest-Icons und browserabhängige Installationshinweise.
- Studio-Verwaltung für Konten/Rollen, Support-Tickets, Tageslimit, Wartungsmodus und öffentliche Ankündigungen.
- Aggregierte Admin-Übersicht mit neuen Konten, bestätigten E-Mail-Adressen, aktiven Nutzern, Chat-Aktivität und Ticketstatus. Es werden keine Chat-Inhalte in der Übersicht ausgegeben.
- Die Installationsfunktion setzt HTTPS, ein unterstütztes Browser-Verhalten und eine gültige Service-Worker-/Manifest-Konfiguration voraus. Auf iPhone/iPad erfolgt das Hinzufügen über Safari → Teilen → Zum Home-Bildschirm.


## New workspace and administration features
- User preferences: server-stored personal instructions and allow-listed Groq model selection. Configure additional models with \`GROQ_ALLOWED_MODELS=model-a,model-b\`.
- TILLBOT Memory: user-managed notes stored per account and included as context in AI requests.
- Workspaces: private project spaces with owner-only CRUD.
- Admin analytics: daily user/chat/message aggregates; message history begins accumulating after the daily usage table migration.
- Monitoring: server/chat errors are stored without chat content, credentials, or request bodies.
- Admin activity log: records admin API paths and methods, not request payloads.
- Feature flags: centrally stored and checked server-side for memories, workspaces, and image attachments. Image generation, web search, and public API remain disabled until their provider/service integration is configured.
- Admin permissions: optional per-admin overrides for users, support, features, and system. Unset overrides default to allowed for compatibility.
- Dashboard widgets can be reordered by drag-and-drop; order is stored locally in the browser.
- Speech: browser speech recognition for dictation and speech synthesis for reading the latest answer.
- Chat search includes saved chat history; PDF export uses the browser print dialog ("Save as PDF").


### Remaining integrations (not enabled yet)
The following requested features require a separately configured provider or infrastructure and are intentionally not represented as working controls yet:
- Image generation: requires an image-provider integration and \`IMAGE_API_KEY\`.
- Web search: requires a search provider integration and \`TAVILY_API_KEY\`.
- Public developer API: requires scoped API-key issuance, revocation, quotas and public API documentation; the feature flag remains disabled.
- PDF/document import: image analysis is supported, but arbitrary PDF parsing is not yet implemented.
- Database backup/restore: use managed PostgreSQL backups in the hosting provider until an authenticated, tested backup-and-restore workflow is implemented. No fake "backup" action is exposed.
- Push notifications: admin metrics refresh periodically while the dashboard is open; browser push delivery is not yet implemented.
