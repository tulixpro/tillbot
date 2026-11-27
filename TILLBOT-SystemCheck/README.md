# TILLBOT SYSTEM CHECK (Windows)

Lokales Windows-Diagnoseprogramm für Administratoren.

## Installation

1. Lade `TILLBOT-SystemCheck.ps1` und `Install-TILLBOT-SystemCheck.ps1` aus diesem Ordner herunter.
2. Lege beide Dateien in denselben Ordner.
3. Starte den Installer per Rechtsklick → Mit PowerShell ausführen und bestätige die UAC-Abfrage.
4. Starte TILLBOT SYSTEM CHECK über Desktop oder Startmenü.

Windows 10/11 und Windows PowerShell werden benötigt.

## Prüfmodi

- Schnellprüfung: System, Defender-Status, Firewall, UAC, SMBv1, RDP, Secure Boot, BitLocker, Updates und Speicher.
- Normalprüfung: plus Defender-Schnellprüfung, Bedrohungsverlauf und Systemereignisse.
- Tiefenprüfung: zusätzlich DISM ScanHealth und SFC verifyonly. Es werden keine Reparaturen ausgeführt.

Die Laufzeit hängt vom PC ab und ist nicht garantiert. Die gewünschten 15/30 Minuten sind keine festen Laufzeiten.

## Sicherheit & Datenschutz

- Nur lokaler PC, Adminrechte erforderlich.
- Keine Cloud-Übertragung, Telemetrie, Passwörter oder Browserdaten.
- Keine Exploit-Tests, keine Scans fremder Geräte, keine Änderungen an Firewall oder Defender.
- Prüft häufige Fehlkonfigurationen, ist aber kein vollständiger CVE-Schwachstellenscanner und kein Penetrationstest.
- Berichte lokal unter `%ProgramData%\TILLBOT\SystemCheck`.
