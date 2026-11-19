# TILLBOT – Release- und Ausbauplan

Stand: 19. November 2026

Dieses Dokument hält den aktuellen technischen Stand und einen vorsichtigen, kostenfreien Veröffentlichungsweg fest. Es ist eine Arbeits- und Prüfliste, keine Bestätigung, dass alle Punkte bereits umgesetzt oder live getestet wurden.

## 1. Aktueller Aufbau

- **Frontend:** statische Web-App auf GitHub Pages.
- **Backend:** Node.js/Express auf Render.
- **Datenbank:** PostgreSQL; der konkrete Anbieter und dessen Tarif müssen separat geprüft werden.
- **KI im Live-Stand:** Groq. Der Browser erhält den API-Schlüssel nicht.
- **Konten:** Passwort-Hashing mit bcryptjs und JWT-Sitzungen.
- **Wichtig:** GitHub Pages allein kann den KI-Chat nicht ausführen. Backend, Datenbank und ein erreichbarer KI-Anbieter müssen funktionieren.

## 2. Bereits vorbereitete, noch nicht veröffentlichte Änderungen

| Pull Request | Inhalt | Status / wichtige Einschränkung |
| --- | --- | --- |
| [#18 – TILLBOT Core](https://github.com/tulixpro/tillbot/pull/18) | Kleines Transformer-Forschungsprojekt mit zufälligen Startgewichten | Nicht trainiert; kein Ersatz für den Live-KI-Dienst. |
| [#20 – Core-Trainingspipeline](https://github.com/tulixpro/tillbot/pull/20) | Datensatzprüfung, Trainingsablauf, Checkpoints, Tests und Evaluation | Baut auf #18 auf; noch kein leistungsfähiges trainiertes Modell. |
| [#23 – Trainingsdaten-Center](https://github.com/tulixpro/tillbot/pull/23) | Admin-Oberfläche zum Prüfen und Exportieren freigegebener Trainingsbeispiele | Verwaltet Daten; trainiert selbst kein Modell. |
| [#24 – Cloudflare Workers AI | kostenloser Anbieter-Modus](https://github.com/tulixpro/tillbot/pull/24) | Opt-in-Adapter; nicht zusammengeführt, nicht live aktiviert und noch nicht mit echten Zugangsdaten end-to-end getestet. |
| [#25 – UI-Politur](https://github.com/tulixpro/tillbot/pull/25) | Mobile- und Bedienungsverbesserungen | Nicht zusammengeführt; noch kein echter Browser-/Gerätetest. |

Die PRs bleiben getrennt reviewbar. #20 hängt von #18 ab und muss in der richtigen Reihenfolge behandelt werden. Nichts davon gilt als live, bevor es geprüft, freigegeben und veröffentlicht wurde.

## 3. Kostenfreier KI-Betrieb

Der optionale Cloudflare-Modus aus PR #24 verwendet standardmäßig das Modell `@cf/zai-org/glm-4.7-flash`.

Benötigte Render-Umgebungsvariablen für diesen Modus:

- `AI_PROVIDER=cloudflare`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Sicherheitsregeln:

- Zugangsdaten ausschließlich in den geheimen Umgebungsvariablen des Backend-Hosters eintragen.
- Niemals Schlüssel in GitHub-Dateien, Frontend-Code, Screenshots oder Chatnachrichten schreiben.
- Ein Elternteil/Erziehungsberechtigter sollte beim Erstellen und Verwalten des Cloudflare-Kontos helfen.
- Keine Zahlungsart, kein Upgrade und keine kostenpflichtige Überschreitung aktivieren.
- Wenn das kostenlose Kontingent erschöpft oder der Dienst ausgelastet ist, soll TILLBOT eine verständliche Fehlermeldung zeigen – nicht heimlich zu einem möglicherweise kostenpflichtigen Anbieter wechseln.

Cloudflare Workers AI dokumentiert ein begrenztes kostenloses Tageskontingent von 10.000 Neurons. Das ist **nicht unbegrenzt** und lässt sich nicht pauschal in eine feste Zahl von Chatnachrichten umrechnen. Die Verfügbarkeit des Vision-Modells im kostenlosen Tarif muss separat geprüft werden; Bildanalyse darf bis dahin nicht als garantiert kostenlos beworben werden.

## 4. Vor Veröffentlichung zwingend prüfen

- [ ] PR #24 technisch reviewen: Provider-Auswahl, Fehlerbehandlung, Streaming und Bildpfad.
- [ ] Automatische Tests für beide Provider-Modi ergänzen bzw. ausführen.
- [ ] Cloudflare-Verbindung mit einem Testkonto und ohne aktivierte Abrechnung prüfen.
- [ ] Text-Chat, Streaming, ungültige Zugangsdaten, Rate-Limit/Quota und Kapazitätsfehler testen.
- [ ] Vision/Bildanalyse separat prüfen; bei fehlender Free-Verfügbarkeit deaktiviert lassen oder klar kennzeichnen.
- [ ] PR #25 auf echtem Mobilgerät und Desktop im Browser ansehen.
- [ ] Die zwei High-Severity-Hinweise aus dem letzten Render-Build/NPM-Audit untersuchen und die betroffenen Abhängigkeiten samt Fix-Versionen nachvollziehen.
- [ ] Datenbankanbieter, Tarif, Speichergrenze, Backups und mögliche Kosten verifizieren.
- [ ] Anmeldung, Registrierung, Chatverlauf, Adminrechte und Datenbank-Neustartverhalten testen.
- [ ] Datenschutztexte mit dem tatsächlichen Datenfluss abgleichen: Nachrichten und angehängte Bilder werden an den gewählten KI-Anbieter übermittelt; Konten und Chatdaten liegen in PostgreSQL.
- [ ] Erst nach erfolgreicher Prüfung und ausdrücklicher Freigabe zusammenführen und veröffentlichen.

## 5. Was „kostenlos“ hier realistisch bedeutet

- Render-Webservice: aktuell als Free-Tarif beobachtet; Free-Tarife können Einschränkungen wie Schlaf-/Kaltstartzeiten haben.
- GitHub Pages: statisches Hosting; keine KI-Rechenleistung.
- Cloudflare Workers AI: begrenztes tägliches Gratis-Kontingent, keine unbegrenzte Nutzung.
- PostgreSQL: Tarif und Anbieter sind noch nicht verifiziert. Deshalb kann derzeit **nicht** zugesichert werden, dass der gesamte TILLBOT-Betrieb einschließlich Datenbank dauerhaft kostenlos bleibt.
- Keine bezahlte GPU und kein Cloud-Training des eigenen Core-Modells eingeplant.

## 6. Rückfallplan

1. Den bisherigen Live-Stand auf `main` nicht durch ungetestete Änderungen ersetzen.
2. Cloudflare zunächst nur über `AI_PROVIDER=cloudflare` nach erfolgreichem Test aktivieren.
3. Bei Problemen den Provider-Modus bewusst zurückstellen und die vorhandene Groq-Konfiguration nur verwenden, wenn sie weiterhin verfügbar und ausdrücklich gewünscht ist.
4. Niemals automatisch auf einen kostenpflichtigen Anbieter wechseln.
5. Nach jeder Freigabe Render-Deploy-Status, Startprotokoll, API-Status und einen echten Testchat kontrollieren.

## 7. Abgrenzung TILLBOT Core

Das Core-Projekt ist ein separates Forschungsprojekt. Ein Transformer mit zufälligen Gewichten wird nicht durch das Anlegen eines Trainingsskripts zu einer brauchbaren Chat-KI. Dafür wären ein rechtlich nutzbarer, ausreichend großer Datensatz, geeignete Rechenleistung, längeres Training, unabhängige Qualitäts- und Sicherheitstests sowie eine eigene Betriebsplanung erforderlich. Das alte Notebook mit GT 555M ist dafür keine realistische Trainingsplattform für ein modernes großes Sprachmodell.

## 8. Definition of Done

TILLBOT gilt erst dann als bereit für die kostenlose Cloudflare-Umstellung, wenn:

1. die relevanten Änderungen reviewed und freigegeben sind,
2. automatisierte Tests erfolgreich sind,
3. eine echte Cloudflare-Testanfrage erfolgreich beantwortet wird,
4. Quota-/Kapazitätsfehler verständlich und ohne kostenpflichtigen Fallback behandelt werden,
5. die Datenbank- und Hostingkosten geklärt sind,
6. ein freigegebener Deploy live ist und ein Testchat auf der öffentlichen Website funktioniert.
