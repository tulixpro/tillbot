# TILLBOT – Cloudflare Workers AI einrichten

TILLBOT nutzt in diesem Projekt das offene Qwen-Modell `@cf/qwen/qwen3.8-27b` über Cloudflare Workers AI. Das Modell wird von Cloudflare gehostet; TILLBOT trainiert es nicht selbst.

## 1. Cloudflare vorbereiten

1. Melde dich bei Cloudflare an und öffne **Workers AI** im Dashboard.
2. Wähle **Use REST API**.
3. Erstelle dort einen Workers-AI-API-Token und kopiere die angezeigte Account-ID.
4. Falls du einen eigenen Token statt der Vorlage erstellst, braucht er die Berechtigungen **Workers AI – Read** und **Workers AI – Edit**.

## 2. Render konfigurieren

Öffne den TILLBOT-Webservice in Render und gehe zu **Environment**. Lege diese Variablen an:

- `CLOUDFLARE_ACCOUNT_ID`: die Cloudflare Account-ID
- `CLOUDFLARE_API_TOKEN`: der geheime API-Token

Optional:

- `CLOUDFLARE_MODEL`: Standard ist `@cf/qwen/qwen3.8-27b`
- `MAX_CONCURRENT_CHATS`: Standard ist 2; der Code begrenzt den Wert auf maximal 2

Speichere die Variablen. Render startet danach einen neuen Deploy, sobald die Änderung auf dem verbundenen Branch aktiv ist.

**Wichtig:** Den API-Token niemals in GitHub, in Chat-Nachrichten oder in den Browser-Code schreiben. Nur als geheime Render-Environment-Variable speichern.

## 3. Kostenloses Kontingent

Cloudflare Workers AI stellt laut aktueller Preisseite im Free-Tarif 10.000 Neurons pro Tag bereit. Wenn das Kontingent aufgebraucht ist, schlagen weitere Modellanfragen fehl, bis es zurückgesetzt wird. Das ist kostenlos, aber nicht unbegrenzt und keine Verfügbarkeitsgarantie. Es wird in diesem Projekt kein kostenpflichtiger Plan aktiviert.

## 4. Funktionstest nach der Einrichtung

Nach dem Deploy müssen mindestens diese Punkte geprüft werden:

- `GET /api/status` und Anmeldung
- Text-Chat mit Streaming
- Foto-/Bildfrage mit dem Vision-Modell
- Quellenanzeige bei einer passenden Wissensfrage
- Verhalten bei fehlendem oder ungültigem Token
- Verhalten bei ausgeschöpftem Kontingent oder vorübergehender Überlastung

Die alte Groq-Verbindung und ihr Schlüssel werden erst entfernt, nachdem diese Tests erfolgreich waren. Konten und gespeicherte Chatverläufe werden bei der KI-Umstellung nicht gelöscht.
