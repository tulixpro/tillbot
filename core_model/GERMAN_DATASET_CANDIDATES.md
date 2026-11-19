# Kandidaten für deutsche TILLBOT-Core-Trainingsdaten

Stand der Recherche: 19.11.2026. Diese Liste ist eine Vorauswahl zur manuellen Prüfung, keine Freigabe zum Training. Es wurden keine externen Datensätze heruntergeladen.

## Kandidaten

| Quelle | Sprache / Inhalt | Angegebene Lizenz / Bedingungen | Eignung für allgemeine KI | Status |
|---|---|---|---|---|
| [Mozilla Common Voice – German, Scripted Speech 27.0](https://commonvoice.mozilla.org/datasets) | Deutsche Sprachaufnahmen mit Transkripten; ASR-Datensatz | Mozilla Data Collective führt CC0-1.0 für diese Ausgabe auf | Nur ergänzend für Schreibvarianten/gesprochene Sprache; primär Sprach-zu-Text, kein breit gefächerter Wissenskorpus | **Prüfen**: exakte Version, Datensatz-Metadaten und Umfang; nicht als Hauptkorpus verwenden |
| [Deutschsprachige Wikipedia / Wikimedia](https://dumps.wikimedia.org/) | Enzyklopädische Artikel | Die meisten Wikimedia-Texte stehen unter CC BY-SA 4.0 und GFDL; Einzelfälle und Versionshistorie prüfen | Gute Themenbreite für erklärende Texte, aber enzyklopädischer Stil und Lizenzpflichten | **Rechtlich prüfen**: Attribution, ShareAlike, GFDL-Ausnahmen, Datenbankrechte und Umgang mit Versionen klären |
| [GovData – Datenlizenzen](https://data.gov.de/informationen/lizenzen) | Portal für deutsche Verwaltungsdaten; einzelne Datensätze haben eigene Metadaten/Lizenzen | GovData empfiehlt u. a. CC BY 4.0 und CC0; das Portal ist keine pauschale Lizenz für alle Einträge | Potenziell nützlich für sachliche deutsche Inhalte, aber viele Datensätze sind Tabellen statt Fließtext | **Einzeldatensatz prüfen**: nur konkrete Einträge mit eindeutig dokumentierter Lizenz auswählen |

## Lizenz-Hinweise

- CC0 ist für Wiederverwendung besonders unkompliziert, sofern die konkrete Quelle tatsächlich CC0 ausweist und keine zusätzlichen Rechte (z. B. Datenschutz, Persönlichkeitsrechte oder Rechte Dritter) entgegenstehen.
- CC BY 4.0 erlaubt laut Lizenztext auch kommerzielle Nutzung und Bearbeitung, verlangt aber angemessene Namensnennung, Lizenzhinweis und Änderungsangabe.
- CC BY-SA 4.0 enthält zusätzlich ShareAlike-Pflichten. Vor dem Einsatz in einem Modellprojekt muss geklärt werden, welche Pflichten für Datensatz, abgeleitete Materialien und mögliche Verbreitung gelten.
- Eine Lizenz-Zusammenfassung ersetzt nicht den vollständigen Lizenztext. Die konkrete Version, Rechteinhaber, Metadaten und mögliche Drittinhalte müssen geprüft werden.
- Öffentlich erreichbar bedeutet nicht automatisch frei für beliebige Nutzung.

## Vorläufige Empfehlung

1. Zuerst selbst erstellte deutsche Trainingsdialoge und Erklärtexte verwenden, deren Rechte TILLBOT eindeutig gehören.
2. Common Voice höchstens als separates Sprach-/Transkript-Experiment betrachten, nicht als allgemeine Wissensbasis.
3. Wikipedia und GovData nur nach dokumentierter Einzelfallprüfung aufnehmen.
4. Für jede Quelle einen Eintrag mit URL, Version, Lizenzkopie, Prüfer, Prüfdatum und Entscheidung in einem separaten Quellenregister führen.
5. Keine Quelle in `reviewed_text` kopieren, bevor sie ausdrücklich freigegeben wurde.

## Nicht aufgenommen

Große Web-Scrapes, unklare Hugging-Face-Reuploads, nicht dokumentierte OPUS-Unterkorpora, private Chatlogs und Quellen mit unklarer kommerzieller/ML-Nutzung werden nicht als Trainingsquellen empfohlen.
