# RAUMWERK – Android-App (native WebView)

Eine **eigenständige Android-App**, die die RAUMWERK-Web-App **offline** aus
gebündelten Assets lädt – über einen virtuellen HTTPS-Origin
(`WebViewAssetLoader`), damit ES-Module und Kamera/AR funktionieren.

Sie lädt **nicht** die Desktop-Seite im Kleinen, sondern eine **eigenständige,
für das Smartphone gebaute Oberfläche** (`web/raumwerk/mobil/`) im Designsystem
**„Ziegelwerk"** (Konzept v2 §6):

- **Seitenmenü (Drawer)** als Hauptnavigation über die Bereiche Projekte · Plan ·
  Scan · AR-Planung · 3D · Normprüfung · Doku.
- Palette Ziegelrot `#A8432A`, Sand `#D9C2A3`, Anthrazit `#2C2A28`,
  Kalk-Off `#F1E9DD`, Fugengrau `#6E5B4E`, Signal `#E8B44A`.
- Typografie: **Zilla Slab** (Titel), **Source Sans 3** (Fließtext),
  **IBM Plex Mono** (alle Maße) – als Latin-Subsets unter `web/lib/fonts/`
  eingebettet (OFL), damit die App offline bleibt.
- Prinzipien: Trefferflächen ≥ 48 dp · **Fugenlinien statt Schatten** ·
  Maße immer monospaced · Radien max. 3 px · Mauerwerks-Raster als Struktur.
- **Höhenbezug umschaltbar** (Konzept §10): Rohboden ⇄ Fertigfußboden; alle
  Montagehöhen rechnen im gewählten Bezug.
- **Dark Mode („Baustelle")** über das Seitenmenü.

Dieselbe erprobte Fachlogik (Store, Geometrie, Normen, Plan, 3D, Scan, Sensorik)
wie die Web-Workstation liegt darunter – die PC-Planung bleibt unter
`raumwerk/index.html` erreichbar und behält bewusst ihre eigene Gestaltung.

### Echte Gerätesensorik (mehr als ein Browser kann)

`NativeBridge.kt` hängt als `AndroidNative` in die WebView und gibt der Web-App
**echten Hardwarezugriff**, den ein Browser so nicht zuverlässig hat:

- **Lage** aus dem Rotationsvektor (Beschleunigung + Gyroskop + Magnetfeld
  fusioniert): Kompass-Azimut, Neigung, Roll und ein sauberes Quaternion.
- **Ort** über GPS/Netz (Länge/Breite/Höhe/Genauigkeit).
- **Geräte-Steckbrief:** jede physische Kamera (auch **Mono-/IR-Linsen** für
  Nachtsicht und die Einzellinsen einer logischen Multi-Kamera) samt
  Brennweiten, dazu die komplette Sensorliste.

Der neue **Scan-Assistent** (Knopf „Scan") nutzt das: Referenzwürfel bekannter
Kantenlänge als Maßstab, ein **Pfeil auf dem Display** führt per Kompass durch
die noch offenen Blickrichtungen, jede Aufnahme wird mit ihrer Lage und dem Ort
verschlagwortet – die Grundlage für die Photogrammetrie (Schicht ②).

Im normalen Browser fällt die Web-Schicht (`web/raumwerk/native.js`) sauber auf
DeviceOrientation/Geolocation zurück; die App bekommt die echten Sensoren.

---

## APK bauen

### Per CI (empfohlen, hier so vorgesehen)

Der Workflow **`.github/workflows/android.yml`** baut die Debug-APK auf einem
GitHub-Runner (dort ist das Android-SDK verfügbar) und legt sie als
**Artefakt** `raumwerk-android-debug` ab. Nach jedem Push auf `android-app/**`
oder `web/**` – oder manuell über „Run workflow". Die `app-debug.apk` unter den
Artefakten herunterladen und aufs Gerät ziehen (Installation aus unbekannten
Quellen erlauben).

### Lokal (mit Android-SDK)

```bash
cd android-app
./gradlew assembleDebug
# Ergebnis: app/build/outputs/apk/debug/app-debug.apk
```

Voraussetzung: JDK 17 und ein Android-SDK (z. B. via Android Studio) mit
Platform 34 und Build-Tools 34.

---

## Aufbau

- `app/src/main/java/de/raumwerk/app/MainActivity.kt` – WebView +
  `WebViewAssetLoader`, Kamera-Durchreichung, Sensor-Lebenszyklus, lädt
  `raumwerk/index.html?skin=ziegel`.
- `app/src/main/java/de/raumwerk/app/NativeBridge.kt` – Lage/GPS/Kamera-Steckbrief
  als `AndroidNative` für die Web-App.
- `app/src/main/res/` – Design: Farben, Backstein-Theme, Splash, Adaptive-Icon.
- `app/build.gradle.kts` – `kopiereWeb`-Task kopiert `../web` nach `assets/`.

`assets/` und `build/` sind erzeugt und nicht eingecheckt.

---

## Grenzen

- **Debug-APK** (unsigniert für den Store). Für Play Store: Release-Build +
  Signierung ergänzen.
- Echtes AR-Welttracking (ARCore/WebXR) braucht zusätzliche Einrichtung; das
  Magic-Window (Kamera + Lagesensor) läuft ohne.
