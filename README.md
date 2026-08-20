# Remix360Pro

Bildbearbeitung für Immobilienfotos. React + TypeScript + Vite, läuft komplett
im Browser. Jeder Nutzer hinterlegt seinen eigenen API-Schlüssel — dem Betreiber
entstehen keine Kosten.

## Version

Die Nummer im Header kommt aus `package.json` und wird beim Bauen eingesetzt
(`__APP_VERSION__` in `vite.config.ts`). Sie kann deshalb nicht vom
tatsächlichen Stand abweichen. Mit dem Mauszeiger über der Nummer erscheint
zusätzlich das Build-Datum.

Bei jeder Änderung nur `version` in `package.json` hochzählen — sonst nichts.

## Lokal starten

```bash
npm install
npm run dev
```

`npm run build` prüft zuerst die Typen und baut dann nach `dist/`.

## Änderungen

### 4.1.2

- **Preis für Nano Banana Pro war zu hoch angesetzt** (0,24 statt 0,15 USD).
  Die Kostenanzeige und die Budgetgrenze haben dadurch zu viel gerechnet.

#### Auflösung und Preis auf fal, Stand August 2026

| Modell | 1K | 2K | 4K |
|---|---|---|---|
| Nano Banana 2 | $0.08 | $0.12 | $0.16 |
| Nano Banana Pro | $0.15 | $0.15 | $0.30 |

Bei Pro fallen 1K und 2K unter dieselbe Standardrate — 2K kostet also nichts
extra, erst 4K verdoppelt. Bei Nano Banana 2 kostet 2K das 1,5-fache.

Die App fährt bewusst 2K. Für Portale wie ImmoScout24 ist 4K verschenkt, weil
dort ohnehin herunterskaliert wird; sinnvoll ist es nur für Druck.

### 4.1.1

- **Sonnenlicht bei Innenaufnahmen kam zu selten durchs Fenster.** Die
  Realismus-Korrektur aus 4.1.0 war zu breit angelegt: die Randbedingung
  "im Zweifel weniger" galt pauschal und hat auch die Beleuchtung gedämpft,
  und bei *Intensive Sonne* waren sichtbare Lichtstrahlen ausdrücklich
  verboten. Zurückhaltung gilt jetzt nur noch für Struktur, Material und
  Farbe. Die Lichtwirkung ist als geforderte Wirkung formuliert und steht im
  Prompt an erster Stelle — was doppelt zählt, weil die Kurzfassung für
  FLUX und Seedream nur die ersten Sätze behält. Die Farbdisziplin bleibt:
  hell wird der Raum durch Licht, nicht durch einen Warmfilter.

### 4.1.0

- **fal-Fehler 422 bei HD und Ultra behoben.** Für alle fal-Modelle wurde
  `image_url` gesendet. Nur FLUX Kontext erwartet das; Seedream und die
  Nano-Banana-Familie erwarten `image_urls` als Array, Seedream zusätzlich
  `image_size` statt `aspect_ratio`. Jedes Modell hat jetzt seine eigene
  Eingabeform (`SHAPES` in `services/providers/fal.ts`).
- **Eco erzeugte sichtbar keine Änderung.** Das war kein Fehler, sondern FLUX
  Kontext: Das Modell folgt kurzen Anweisungen und gewichtet die ersten Sätze
  am stärksten, unser Prompt bestand aber überwiegend aus Verboten. Modelle
  tragen jetzt einen `promptStyle`; instruktionsbasierte Editoren bekommen eine
  Kurzfassung.
- **Intensive Sonne wirkte unecht.** Der Prompt verlangte einen Raum
  „geflutet mit goldener Sonne", was zu einem globalen Sepiastich führte. Jetzt
  sind nur die direkt besonnten Flächen warm, alles andere behält neutralen
  Weißabgleich. Global ergänzt: kein Farbfilter über das ganze Bild.
- **Modellauswahl pro Stufe** im Verbinden-Dialog, inklusive der Google-Modelle
  über fal (Nano Banana).
- Versionsnummer im Header kommt aus `package.json`.

### 4.0.0

Umbau auf Anbieter-Abstraktion. Was dabei repariert wurde:

**Seitenverhältnis war fest auf 16:9.** In `callGeminiApi` stand
`aspectRatio: "16:9"` für jede Aufgabe. Jedes 4:3- oder Hochkantfoto wurde
dadurch beschnitten oder vom Modell erweitert. Das ist die wahrscheinlichste
Ursache, wenn Ergebnisse „nach KI" aussehen. Das Verhältnis wird jetzt aus dem
Originalbild bestimmt (`nearestAspectRatio` in `utils/image.ts`).

**Fünf Optimierungs-Schalter hatten keine Wirkung.**
`verbessereHelligkeitKontrast`, `verbessereFarbe`, `verbessereWetter`,
`fügeSonneHinzu` und `fügeSonneMitLensflaresHinzu` standen in der Oberfläche,
tauchten in `generateSunnyImage` aber nie im Prompt auf. Stattdessen war
`WEATHER: Beautiful weather, blue sky` fest verdrahtet — der Himmel wurde also
auch getauscht, wenn der Nutzer das abgewählt hatte. Alle wirken jetzt.

**Die drei Detail-Fokus-Varianten waren nicht erreichbar.**
`generateDetailImage` kannte „Design & Material", „Licht & Atmosphäre" und
„Möbel & Deko", aber das Detail-Modul setzte immer `'Original'`. Jetzt in der
Oberfläche auswählbar.

**Aufträge blieben auf „pending" hängen.** `handleIntenseSun` und Geschwister
setzten `transformTrigger.current = true`; lief gerade ein Stapel, brach
`handleTransform` am `isProcessing`-Check ab, der Trigger war aber schon
zurückgesetzt. Der Auftrag wurde nie abgeholt. Varianten laufen jetzt direkt.

**Absturz statt Fehlermeldung.** `response.candidates[0].content.parts` wurde
ungeprüft gelesen. Blockiert das Modell aus Sicherheitsgründen, ist `content`
undefined — das gab einen TypeError. Jetzt wird `finishReason` ausgewertet.

**Keine Wiederholung bei 429.** Der einzige Fallback griff bei 403. Auf dem
Gratis-Kontingent ist Drosselung der häufigste Fehler überhaupt; jedes
gedrosselte Bild galt als endgültig fehlgeschlagen.

**Stapel lief streng nacheinander.** 10 Bilder × 3 Tageszeiten = 30 Aufrufe in
Serie. Jetzt drei parallel, mit Abbrechen-Knopf.

**`animate-fade-in` war nirgends definiert** — weder in `index.css` noch in der
Tailwind-CDN-Konfiguration. Die Klasse stand im ganzen Markup und tat nichts.

Kleinkram: `URL.createObjectURL` wurde nie freigegeben; `.sort()` mutierte die
Props-Array in `GalleryItem`; rund ein Dutzend Tailwind-Klassen existierten
nicht (`text-gray-850`, `text-red-550`, `border-red-105`); der Verbinden-Knopf
sagte bei fehlendem Key „Key Verbunden"; die Simulieren-Knöpfe im Kosten-Dialog
schrieben Fantasie-Einträge ins Protokoll, ohne den Monatszähler zu erhöhen,
wodurch Protokoll und Summe auseinanderliefen.

## Aufbau

```
App.tsx                       Zustand und Ablauf, keine Modellnamen
components/                   Oberfläche
services/
  providers/types.ts          Anbieter-Interface
  providers/gemini.ts         Google Gemini
  providers/fal.ts            fal.ai
  providers/index.ts          Registry, Routing, Key-Verwaltung
  prompts.ts                  alle Prompts an einer Stelle
  pipeline.ts                 verkleinern → Cache → Modell → Retry → Ausweichen
  queue.ts                    Parallelität und Backoff
  cache.ts                    Ergebnis-Cache in IndexedDB
  usageService.ts             Kosten und Protokoll
state/jobsReducer.ts          Auftragszustand
utils/image.ts                Verkleinern, Seitenverhältnis, Hashing
```

Ausserhalb von `services/providers/` kommt kein Modellname vor. Ein dritter
Anbieter ist eine Datei plus ein Eintrag in `PROVIDERS`.

## Kosten

| Hebel | Wirkung |
|---|---|
| Verkleinern vor dem Upload auf 1568 px | 12-MP-Foto: ~4 MB → ~350 KB |
| 2K statt 4K als Standard | 4K kostet bei Gemini das Doppelte |
| Sparmodus (Aufgabenrouting) | Belichtung auf Eco, nur Staging und Outpainting auf HD |
| Ergebnis-Cache | identische Wiederholung kostet nichts |

Das Verkleinern entfernt nebenbei alle EXIF-Daten inklusive GPS — Geokoordinaten
in Exposéfotos sind ein reales Leck.

Preise stehen pro Modell in `services/providers/*.ts`, Stand August 2026. Bitte
gelegentlich prüfen.

## Anbieter

fal ist als zweiter Anbieter eingebaut. Sind mehrere Schlüssel hinterlegt,
wechselt die Pipeline bei Auth-, Kontingent- und Netzfehlern automatisch weiter.

**Vor dem Livegang prüfen:** die `nativeId`-Pfade in
`services/providers/fal.ts` gegen die jeweilige Modellseite auf fal.ai
abgleichen — die werden gelegentlich versioniert. Gemini ist getestet.

Ein bestehender Schlüssel aus der alten Fassung (`custom_gemini_api_key`) wird
beim ersten Start automatisch übernommen.

## Deployment

Auf Vercel importieren. Framework Vite, Build `npm run build`, Output `dist`.

Eine einzige Umgebungsvariable, der Zugangscode als SHA-256:

```bash
echo -n "deincode" | shasum -a 256
```

Ergebnis als `VITE_ACCESS_HASH` eintragen. Ist die Variable leer, entfällt die
Abfrage. Die Prüfung läuft weiterhin im Browser — wer die Konsole öffnet, kommt
vorbei. Für echten Schutz braucht es Vercel Deployment Protection.

**Wichtig:** Alle `VITE_*`-Variablen landen im ausgelieferten Bundle. Dort darf
nie ein API-Schlüssel stehen. Die alten `VITE_API_KEY` und
`VITE_GEMINI_API_KEY` sind deshalb ersatzlos entfernt.

## fal.ai als Alleinanbieter

Ein fal-Schlüssel genügt. fal ist kein eigener Modellhersteller, sondern
hostet fremde Modelle — darunter Googles Bildmodelle unter dem Namen
*Nano Banana*:

| Stufe | Modell auf fal | entspricht |
|---|---|---|
| Eco | Nano Banana | Gemini 2.5 Flash Image |
| HD | Nano Banana 2 | Gemini 3 Flash Image |
| Ultra | Nano Banana Pro | Gemini 3 Pro Image |

Dazu FLUX.1 Kontext und Seedream V4 als Alternativen. Welches Modell hinter
welcher Stufe läuft, wird im Verbinden-Dialog gewählt.

Guthaben wird bei fal vorab aufgeladen — auch von jemand anderem als dem
Nutzer der App.

**Hinweis zur Unabhängigkeit:** Ein einzelner Anbieter ist wieder ein einzelner
Ausfallpunkt. Der Sinn der Abstraktion ist, dass ein zweiter Schlüssel
jederzeit dazukommen kann und die Pipeline bei Ausfall automatisch wechselt.

## Was noch offen ist

- Aufträge in IndexedDB sichern, damit ein Reload den Stapel nicht verliert
- Zoom Out auf einen dedizierten Outpainting-Endpunkt statt aufs Chatmodell
- Belichtungskorrektur ohne KI über Canvas — kostenlos und sofort
- Objekt-Profile, damit alle Bilder eines Exposés denselben Look haben
- Kennzeichnung nach EU-KI-Verordnung für Staging und Himmelaustausch
