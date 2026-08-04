# RAUMWERK – Android-App (native WebView)

Eine **eigenständige Android-App**, die die RAUMWERK-Web-App **offline** aus
gebündelten Assets lädt – über einen virtuellen HTTPS-Origin
(`WebViewAssetLoader`), damit ES-Module und Kamera/AR funktionieren.

Sie trägt ein **eigenes, dunkles Design** (Skin `werk`), das sich klar von der
hellen Weboberfläche abhebt: dunkles Instrument, Bernstein-Akzent.

- **Offline:** alles ist eingebettet; kein Server nötig (die Pipeline-Anbindung
  bleibt optional). localStorage speichert die Projekte.
- **Eine Quelle:** die App wird beim Build aus `../web` kopiert (Gradle-Task
  `kopiereWeb`) – Web und App zeigen exakt dasselbe.

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
  `WebViewAssetLoader`, Kamera-Durchreichung, lädt `raumwerk/index.html?skin=werk`.
- `app/src/main/res/` – Design: Farben, dunkles Theme, Splash, Adaptive-Icon.
- `app/build.gradle.kts` – `kopiereWeb`-Task kopiert `../web` nach `assets/`.

`assets/` und `build/` sind erzeugt und nicht eingecheckt.

---

## Grenzen

- **Debug-APK** (unsigniert für den Store). Für Play Store: Release-Build +
  Signierung ergänzen.
- Echtes AR-Welttracking (ARCore/WebXR) braucht zusätzliche Einrichtung; das
  Magic-Window (Kamera + Lagesensor) läuft ohne.
