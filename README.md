# Eagle Homebrew

Foundry-VTT-Modul **Eagle Homebrew**: der Editor zum Erstellen und Bearbeiten von Homebrew-Inhalten
in den Eagle Modulen (Actors, Items, Roll Tables über 18 Objektarten). Es ist das dritte Modul der
Eagle Modules und der zweite Verbraucher von Eagle Library, nach Eagle Flight Control.

**Stand:** Version 0.0.1 (Meilenstein M8a: bedingte Feldrelevanz für Tool/Weapon —
`dadm/m8a-03-deploy-output.md`, Live-Check aussehend; M8 selbst live bestätigt, `dadm/
m8-05-live-check-output.md`). Tool und Weapon blenden Felder, die je nach anderer Auswahl (Waffentyp,
Eigenschaften wie "Versatile"/"Ammunition"/"Magical") keine Wirkung hätten, jetzt aus — dieselben
Bedingungen, die dnd5es eigenes Item-Blatt schon nutzt (`core/item-field-model.ts`s `visibleWhen`,
am dnd5e-Quellcode nachvollzogen, nicht geraten); `type.baseItem` zeigt außerdem echte, nach Waffen-/
Werkzeugart gefilterte Namen statt technischer Schlüssel (asynchroner Nachschlag über dnd5es eigene
`Trait.getBaseItem`-API). Das Modul meldet sich bei
Eagle Flight Control an (API `0.14.0`) und bekommt einen
Open-Button im Hub-Tab. Der öffnet ein eigenes Fenster mit Art- (Actor/Item/Roll Table) und
Unterkategorie-Auswahl über alle 18 Objektarten; **Loot**, **Tool** und **Weapon** haben einen echten
Editor (Loot: Name-Feld, wie seit M4; Tool und Weapon: volle Feldabdeckung nach N21 plus den
Activity-Baustein), die übrigen 15 zeigen einen Platzhalter. Ein neues Item entsteht gleichzeitig als
Welt-Dokument und als Eagle-Library-Eintrag, mit der Regelwerk-Version aus der Welteinstellung
`rulesVersion` und automatischer "Name (Duplicate)"-Umbenennung bei einer Namenskollision (`dadm/
m4-02-apply-output.md`). Bei Tool und Weapon lassen sich zusätzlich beliebig viele Aktionen
("Add Action", fünf Typen: Attack, Damage, Saving Throw, Ability Check, Healing; die Aktivierungsart
Action/Bonus Action/... wählt man in der Auswahlliste des Unterformulars) mit optional ausgelöstem
Effekt hinzufügen, bevor das Objekt angelegt wird — sie werden nach der Anlage in **zwei**
`document.update`-Aufrufen geschrieben, je mit einer eigenen `foundry.utils.deepClone`-Kopie der
Changes, an Welt- **und** Library-Seite gleichermaßen (zwei Live-Check-Funde: M7 Runde 1 schrieb
ursprünglich nur an die Welt-Seite, `dadm/m7-02-apply-output.md`; M7 Runde 3 fand, dass die zweite
Seite sonst eine von Foundrys `Document#update()` bereits mutierte, nicht mehr JSON-taugliche Kopie
bekam, `dadm/m7-hd-1-output.md`). Formularfelder mit einem dnd5e-Katalog sind echte
Mehrfachauswahllisten oder Auswahllisten (`fields.createMultiSelectInput`/`createSelectInput`),
Felder ohne Katalog bleiben Freitext; ein Katalog ohne eigenes Label (Tools/Waffen konkrete Art,
Munitionstyp) zeigt seinen automatisch formatierten Schlüssel statt eines echten Namens (bewusster
Kompromiss, `dadm/m8-02-apply-output.md`). **Bekannte Grenze:** das Fenster ist bei aufgeklapptem
"More fields" trotz zweier Fix-Versuche weiterhin nicht scrollbar (`v13/styles/eagle-homebrew.css`)
— vom Projektleiter für M7 akzeptiert, Aufgriff später.

**Hintergrund der Korrektur:** Nach M4 hat der Projektleiter den Grundgedanken korrigiert
(`dadm/01-project-brief.md`, Abschnitt "Korrektur 2026-09-22"): der Hauptnutzen ist ein eigenes,
verständlicheres Editor-Blatt mit voller Feldabdeckung je Objektart, nicht nur die Welt/Library-
Kopplung. Milestone Plan Version 2 (`dadm/04-milestone-plan.md`) setzt das um: M5 legte das reine
`core/`-Datenmodell für Activities an (`core/activity-model.ts`: fünf Activity-Typen, vollständiges
Feldinventar aus dem dnd5e-Quellcode; `core/effect-model.ts`: ausgelöste ActiveEffects;
`core/path-data.ts`: die gemeinsame Pfad-Verschachtelung), M6 (in Eagle Flight Control) die
Fähigkeit, bestehende Dokumente gezielt zu ändern, M7 verband beides zur UI. M8 (dieser Stand)
generalisiert diesen Mechanismus für eine Objektart eigene Felder (`core/item-field-model.ts`,
strukturell parallel zu `activity-model.ts`) und baut damit die ersten zwei der 16 verbleibenden
Objektart-Editoren; M9-M18 (`dadm/04-milestone-plan.md`) folgen mit demselben Muster. Nur Foundry
v13. Es gibt keine Lizenz (Hobbyprojekt). Das Repo ist lokal, hat keinen Remote, und nichts ist
veröffentlicht.

## Voraussetzungen

- Foundry VTT v13.
- Eagle Flight Control ab Version `0.8.0` (API `0.14.0`).
- Eagle Library ab Version `0.1.0`.

Das Manifest (`v13/module.json`) verlangt beide unter `relationships.requires`.

## Was das Modul heute tut

Registriert sich bei Eagle Flight Control (`core/flight-control.ts`, `v13/module.ts`) mit einer
`open`-Funktion, die Homebrews eigenes Fenster öffnet (`v13/homebrew-application.ts`, nur für
Gamemaster/Assistant). Das Fenster führt durch Art (Actor/Item/Roll Table, `core/catalog.ts`) und
Unterkategorie zu einem Formular; **Loot**, **Tool** und **Weapon** legen tatsächlich etwas an
(Name-Validierung: `core/creation-form.ts`; Version/Duplicate-Logik: `core/creation-target.ts`,
`core/name-key.ts`, aus M3; Anlage in Welt und Library: `core/create-pair.ts`, aus M2), die übrigen
15 Unterkategorien zeigen nur einen Platzhalter. Tool und Weapon zeigen zusätzlich ihre eigenen
Felder mit voller Abdeckung (`core/item-field-model.ts`, M8: `ItemField`/`ITEM_KIND_SPECS`, in
`<fieldset>`-Blöcken je Herkunfts-Vorlage gerendert) und den Activity-Baustein
(`core/activity-model.ts`, `core/effect-model.ts`, `core/activity-batch.ts`): "Add Action" sammelt
Entwürfe im Fenster (kein eigener Request pro Zeile); der "Create"-Klick baut daraus **und** aus den
Item-Feldern ein `document.create`/`document.update`-Paar (`core/document-update.ts`, Flight
Control M6) direkt nach der Anlage. `core/catalog.ts`s `hasActivities`-Feld sagt je Objektart, ob
dnd5es Datenmodell überhaupt Aktivierungen kennt (nicht bei Loot). Die Widget-Fallunterscheidung
(Auswahl/Mehrfachauswahl/Zahl/Häkchen/Freitext je nach Feld) ist seit M8 ein einziger geteilter
Mechanismus (`renderFieldWidget`/`readFieldValue` in `v13/homebrew-application.ts`) für Activity- und
Item-Felder gemeinsam, statt einer zweiten Kopie derselben Regeln.

## Bauen

```
npm install
npm run typecheck
npm test
npm run build
npm run package   # baut release/eagle-homebrew-v13.zip und release/module.json; veröffentlicht nichts
```

`npm run typecheck` braucht die gepinnten Foundry-Types aus
`foundry-vtt-reference-v13/types/src/index.d.mts` (siehe `v13/tsconfig.json`, relativer Pfad — das
Repo muss dafür im selben Elternordner liegen wie `foundry-vtt-reference-v13/`).

`v13/flight-control-api.d.ts` ist eine von Hand aus dem Vertrag von Eagle Flight Control
(`../EagleFlightControl/docs/api-contract.md`) abgeschriebene Typdeklaration, kein gemeinsamer
Code (E7). Sie ist bei Vertragsänderungen von Flight Control nachzuführen.

## `npm audit`

Wie bei Eagle Flight Control und Eagle Library melden die Entwicklungswerkzeuge (Vitest, Vite,
esbuild) einige Advisories, die nur einen lokal lauschenden Dev-/UI-Server betreffen; die Skripte
dieses Repos starten keinen. Eingestuft als `low` im Projektkontext (siehe Deploy-Output von M1
in `dadm/`); nicht blockierend.
