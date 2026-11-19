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
| [#27 – Provider-Kette und Tagesbudget](https://github.com/tulixpro/tillbot/pull/27) | Groq als primärer Anbieter, Cloudflare als optionale Reserve, optional Gemini mit ausdrücklicher Datenschutzfreigabe; tägliches Kontingent und serverseitiger Spam-Schutz. Noch nicht zusammengeführt oder live getestet. |
| [#24 – älterer Cloudflare-Adapter](https://github.com/tulixpro/tillbot/pull/24) | Frühere Einzelanbieter-Implementierung; #27 ist der maßgebliche neuere Provider-Stand. Nicht zusätzlich separat veröffentlichen. |
| [#25 – UI-Politur](https://github.com/tulixpro/tillbot/pull/25) | Mobile- und Bedienungsverbesserungen sowie kompaktere Buttons/Chips | Nicht zusammengeführt; letzter CSS-Stand wartet noch auf CI und echten Browser-/Gerätetest. |

Die PRs bleiben getrennt reviewbar. #20 hängt von #18 ab und muss in der richtigen Reihenfolge behandelt werden. #27 ist der maßgebliche Provider-/Quota-Vorschlag; #24 ist ein älterer, überholter Adapter und soll nicht parallel mit #27 aktiviert werden. Nichts davon gilt als live, bevor es geprüft, freigegeben und veröffentlicht wurde.

## 3. Kostenfreier KI-Betrieb

Der Provider-Vorschlag aus PR #27 priorisiert standardmäßig Groq und kann Cloudflare Workers AI als Reserve verwenden. Gemini ist nur nach ausdrücklicher Aktivierung aller Schutzvariablen verfügbar und bleibt zunächst deaktiviert.

Benötigte Render-Umgebungsvariablen für die Provider-Kette (nur serverseitig):

- Groq: `GROQ_API_KEY`
- Cloudflare: `CLOUDFLARE_ACCOUNT_ID` und `CLOUDFLARE_API_TOKEN`
- Reihenfolge: optional `AI_PROVIDER_ORDER`; nur konfigurierte Anbieter werden verwendet.
- Gemini bleibt aus: eine Aktivierung würde zusätzlich `GEMINI_API_KEY`, `GEMINI_API_ENABLED=true` und `GEMINI_FREE_TIER_DATA_ACK=true` benötigen.

Sicherheitsregeln:

- Zugangsdaten ausschließlich in den geheimen Umgebungsvariablen des Backend-Hosters eintragen.
- Niemals Schlüssel in GitHub-Dateien, Frontend-Code, Screenshots oder Chatnachrichten schreiben.
- Ein Elternteil/Erziehungsberechtigter sollte beim Erstellen und Verwalten des Cloudflare-Kontos helfen.
- Keine Zahlungsart, kein Upgrade und keine kostenpflichtige Überschreitung aktivieren.
- Wenn alle ausdrücklich konfigurierten Gratisanbieter erschöpft oder ausgelastet sind, soll TILLBOT eine verständliche Fehlermeldung zeigen – niemals heimlich zu einem möglicherweise kostenpflichtigen Anbieter wechseln.
- Die kostenlose Gemini-API kann Inhalte zur Verbesserung von Google-Produkten verwenden. Gemini bleibt deshalb deaktiviert, bis Datenschutztext, Alters-/Datenschutzanforderungen und die Einwilligung passend geprüft sind.

Cloudflare Workers AI dokumentiert ein begrenztes kostenloses Tageskontingent von 10.000 Neurons. Das ist **nicht unbegrenzt** und lässt sich nicht pauschal in eine feste Zahl von Chatnachrichten umrechnen. Die Verfügbarkeit des Vision-Modells im kostenlosen Tarif muss separat geprüft werden; Bildanalyse darf bis dahin nicht als garantiert kostenlos beworben werden.

## 4. Vor Veröffentlichung zwingend prüfen

- [ ] PR #27 technisch reviewen: Provider-Reihenfolge, Fehlerbehandlung, Quota-Freigabe, Streaming und Bildpfad.
- [ ] PR #24 als älteren Adapter nicht parallel aktivieren.
- [ ] Automatische Tests für jeden aktivierten Provider-Modus ergänzen bzw. ausführen.
- [ ] Gemini bis zur Datenschutzprüfung ausgeschaltet lassen.
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


## 8. Tägliches Nachrichtenbudget

Der geplante Standard für normale Konten beträgt 20 erfolgreiche KI-Anfragen pro Datenbank-Kalendertag. Der Wert kann im Admin-Dashboard zwischen 1 und 500 angepasst werden. Admin-Konten sind vom TILLBOT-Tageslimit und vom app-internen Minutenlimit ausgenommen.

Das Budget wird serverseitig und atomar reserviert, bevor ein Modellanbieter aufgerufen wird. Bei einem Anbieterfehler oder einem Fehler vor Abschluss wird die Reservierung zurückgegeben. Die Anzeige im Chat zeigt den verbleibenden Tagesstand und den nächsten Reset an.

Wichtig: Das Admin-Budget ist nur innerhalb von TILLBOT unbegrenzt. Externe Anbieter können weiterhin eigene Rate-Limits, Tageskontingente oder Kapazitätsgrenzen durchsetzen. Das gilt insbesondere für kostenlose Tarife.

## 9. Qualitätsstrategie: bestmögliche Qualität ohne Kosten

Ziel ist ein möglichst guter TILLBOT bei einem harten Kostenlimit von 0 EUR. Das bedeutet nicht, dass ein Gratisanbieter unbegrenzte oder jederzeit verfügbare Nutzung garantiert.

### Architekturentscheidung

- TILLBOT bleibt die eigene Anwendung: Oberfläche, Konten, Verlauf, Datenschutzentscheidungen, Provider-Adapter, Tests und später eigene Core-Forschung.
- Das Sprachmodell hinter dem Chat ist vorerst ein externer Dienst. Ein kostenlos nutzbarer Anbieter macht dessen Modell nicht zu einem selbst trainierten TILLBOT-Modell.
- Provider bleiben austauschbar. Ein Wechsel erfolgt nur nach Tests und ausdrücklicher Konfiguration; niemals automatisch zu einem Anbieter, der Kosten verursachen könnte.
- Zuerst wird Text-Chat stabilisiert. Bild-, Audio- und andere Funktionen werden erst dann als kostenlos unterstützt beworben, wenn sie separat geprüft wurden.

### Modell nicht nach Namen oder Parameterzahl auswählen

Vor einer Auswahl wird ein kleines, festes TILLBOT-Testset gepflegt. Es enthält selbst erstellte, nicht private Beispielaufgaben für:
1. Deutsch: klare Antworten, Grammatik und Zusammenfassungen.
2. Mehrstufiges Denken: einfache Logik- und Planungsaufgaben mit nachvollziehbaren Kriterien.
3. Mathematik: Aufgaben mit überprüfbarem Ergebnis.
4. Programmieren: kleine Aufgaben mit erwarteten Ausgaben und Syntaxprüfung.
5. Gesprächsqualität: Umgang mit unklaren Fragen, Rückfragen und Fehlerkorrektur.
6. Sicherheit: höfliche Ablehnung gefährlicher oder unpassender Anfragen und Schutz vor erfundenen Behauptungen.

Jeder Modellkandidat wird mit identischen Prompts und Einstellungen getestet. Bewertet werden Korrektheit, Befolgung der Aufgabe, Deutschqualität, Latenz, Fehlerrate, Kontextverhalten und tatsächliche Gratis-Verfügbarkeit. Es wird kein Modell als „so gut wie ChatGPT“ bezeichnet, solange unabhängige Tests das nicht belegen.

### Kandidaten und laufende Prüfung

- Cloudflare Workers AI bleibt der erste zu prüfende kostenfreie Kandidat aus PR #24. Die dort eingetragene Modell-ID muss unmittelbar vor Aktivierung im aktuellen offiziellen Modellkatalog auf Free-Verfügbarkeit und Status geprüft werden.
- Cloudflare dokumentiert Limits und Kapazitätsfehler; 10.000 Neurons pro Tag sind ein begrenztes Kontingent, keine feste Anzahl Chatnachrichten. Siehe [Workers AI Limits](https://developers.cloudflare.com/workers-ai/platform/limits/) und [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).
- Groq kann als bestehende Integration für Vergleichstests erhalten bleiben, wird aber nur als kostenfrei behandelt, wenn das konkrete Konto und die aktuellen Limits dies bestätigen. Die Limits sind kontospezifisch; siehe [Groq Rate Limits](https://console.groq.com/docs/rate-limits).
- Neue Anbieter werden nicht allein aufgrund einer kostenlosen Testoberfläche aufgenommen. Vorher müssen API-Nutzungsbedingungen, Datenschutz, Gratisgrenzen, Modellstatus und die Eignung für den Einsatz mit Konten Minderjähriger geprüft werden.

### Umsetzungsphasen

1. **Sicherheit und Kosten zuerst:** keine automatische Provider-Umschaltung, keine stillen Paid-Fallbacks, keine Abrechnungsaktivierung; API-Schlüssel nur serverseitig.
2. **Provider-Adapter absichern:** Konfiguration validieren, Zeitlimits setzen, Fehlercodes unterscheiden, Streaming-Ende und Abbruch sauber behandeln und keine Provider-Geheimnisse in Logs ausgeben.
3. **Automatisierte Provider-Tests:** Mock-Tests für erfolgreiche Antworten, ungültige Zugangsdaten, 429/Quota, 5xx, Timeout, kaputtes JSON, leere Antwort, Streaming und Bildanfrage.
4. **Modellvergleich:** Testset gegen alle tatsächlich kostenlosen Kandidaten ausführen; Ergebnisse dokumentieren, nicht aus Modellwerbung ableiten.
5. **Kleiner Live-Test:** nur nach Freigabe, mit einem Testkonto und ohne aktivierte kostenpflichtige Nutzung; anschließend Quota- und Fehlerfälle prüfen.
6. **Öffentliche Aktivierung:** erst nach Review, erfolgreichen Tests, bestätigtem Datenbanktarif und ausdrücklicher Freigabe. Bis dahin bleibt der bestehende Live-Stand unverändert.
7. **Core separat:** die Trainingspipeline und das kleine Transformer-Projekt bleiben Forschungsarbeit. Kein automatisches Nachtrainieren mit privaten Chatverläufen. Trainingsdaten müssen rechtlich nutzbar, geprüft und bewusst freigegeben sein.

### Erfolgskriterien

- Keine unerwarteten Kosten und kein Paid-Fallback.
- Der aktive Provider und seine Modell-ID sind in der Serverkonfiguration eindeutig.
- Quota-, Kapazitäts- und Netzwerkfehler werden verständlich angezeigt.
- Ein reproduzierbarer Modellvergleich ist vorhanden.
- Die wichtigsten Providerpfade sind automatisiert getestet.
- Eine Veröffentlichung erfolgt erst nach ausdrücklicher Freigabe und einem erfolgreichen Testchat.
