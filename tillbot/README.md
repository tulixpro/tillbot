# TILLBOT GitHub Pages

## Veröffentlichung (nur Browser, nichts installieren)
1. GitHub öffnen und anmelden/Account erstellen.
2. Neues Repository erstellen, z.B. `tillbot`, auf **Public** stellen.
3. Diese Dateien im Repository hochladen: `index.html`, `style.css`, `app.js`, `manifest.json`, `sw.js`.
4. Repository → Settings → Pages.
5. Bei Build and deployment `Deploy from a branch` auswählen, Branch `main`, Ordner `/ (root)`, Save.
6. Nach einigen Minuten erscheint deine Pages-Adresse.

## KI
Die Seite nutzt Transformers.js und SmolLM2-360M-Instruct lokal im Browser via WebGPU. Beim ersten Klick auf „KI-Modell laden“ wird das Modell von Hugging Face heruntergeladen und im Browser verarbeitet. WebGPU und genügend RAM/GPU werden benötigt. Falls WebGPU fehlt, funktioniert die KI nicht auf diesem Gerät.

## Kostenlos und Grenzen
- GitHub Pages Hosting ist für ein persönliches Projekt kostenlos (Public Repo).
- KI-Inferenz läuft im Browser, kein eigener Server und kein API-Schlüssel.
- Das Modell ist klein: Antworten sind deutlich weniger leistungsfähig als große Cloud-KIs.
- Modell-Download benötigt Internet; später kann Cache helfen.
- GitHub Pages ist statisches Hosting und nicht für vertrauliche Konten/Passwörter oder SaaS-Backend gedacht.
- Admin-Schaltfläche ist ausdrücklich nur eine Demo, keine echte sichere Adminfunktion.
- Chatverlauf liegt nur im lokalen Browser. Kein Konto/Sync.
- PWA offline cached die Oberfläche; KI-Modell muss verfügbar und Browser kompatibel sein.

## Sicherheit
Diese statische Demo hat keine echte Benutzerverwaltung, Adminrechte, Moderation oder Backend. Nicht als öffentliche Plattform mit Nutzerkonten verwenden.
