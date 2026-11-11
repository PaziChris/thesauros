# Thesauros

Persönliche Schatzkammer-App für Goldschmuck, Uhren und Münzen: Kaufpreis, aktueller Wert, Gewinn, Fotos und Diagramme.

- Läuft als Website auf GitHub Pages, installierbar als App (iPhone: „Zum Home-Bildschirm“, PC: Chrome/Edge „Als App installieren“).
- Daten liegen in Firebase Firestore (Projekt `thesauros-4a242`), Login mit Google. Jeder Nutzer sieht nur seine eigenen Daten (siehe `firestore.rules`).
- Gold- und Silberpreis werden täglich automatisch geladen (gold-api.com, Wechselkurs von frankfurter.app); manuelles Eintragen ist möglich.
- Fotos werden im Browser auf max. 800 px verkleinert und direkt in Firestore gespeichert (kein Firebase Storage nötig).
