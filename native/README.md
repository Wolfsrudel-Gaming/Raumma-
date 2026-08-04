# RAUMWERK – native Apps (Android & iOS)

Neben der Weboberfläche gibt es **eine verlinkte Android- und iOS-App**. Sie
sind bewusst **dünne Hüllen um dieselbe Web-App** (`../web`), erstellt mit
[Capacitor](https://capacitorjs.com/). So gibt es nur *eine* Codebasis –
Web, Android und iOS zeigen exakt dasselbe.

Zwei Vorteile der nativen Hülle gegenüber dem reinen Browser:

- **Kamera & AR ohne HTTPS-Aufwand:** Die WebView läuft in einem sicheren
  Kontext (`capacitor://`), Kamera und Sensoren funktionieren mit der nativen
  Berechtigung – kein Zertifikat/Reverse-Proxy nötig wie im Browser.
- **Store-fähig:** Play Store und App Store, App-Icon, Splash, Offline-Start.

Wer es noch schlanker will: Für Android geht auch eine **PWA/TWA** (die
Web-App ist bereits installierbar, siehe `../web/raumwerk/manifest.webmanifest`).

---

## Voraussetzungen

- Node.js
- **Android:** Android Studio (+ SDK)
- **iOS:** macOS mit Xcode

---

## Aufbau

```bash
cd native
npm install

# Web-App nach www/ kopieren und Plattformen anlegen
npm run web:copy
npx cap add android      # legt android/ an
npx cap add ios          # legt ios/ an   (nur auf macOS)

# Bei jeder Web-Änderung: kopieren + synchronisieren
npm run sync

# In der jeweiligen IDE öffnen und bauen/starten:
npm run android          # öffnet Android Studio
npm run ios              # öffnet Xcode
```

`android/` und `ios/` werden von `cap add` erzeugt und sind nicht eingecheckt
(sie entstehen auf dem Rechner mit den SDKs).

---

## Zwei Betriebsarten

**a) Web-App bündeln (Standard).** `capacitor.config.json` zeigt mit
`webDir: "www"` auf die kopierte Web-App. Die App enthält alles und läuft
offline. Aktualisieren = `npm run sync` + neu bauen.

**b) Gehostete Web-App laden („live verlinkt").** Soll die App immer die
neueste, zentral gehostete Weboberfläche zeigen, in `capacitor.config.json`
ergänzen:

```json
"server": { "url": "https://raumwerk.example.de/raumwerk/", "cleartext": false }
```

Dann ist die native App eine dünne Verknüpfung auf die Web-App; Updates
erscheinen ohne Store-Release. (Für den Offline-Fall sorgt dann der
Service Worker der PWA.)

---

## Berechtigungen (nach `cap add` eintragen)

Die AR- und Aufnahme-Funktionen brauchen die Kamera.

**Android** – `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
```

**iOS** – `ios/App/App/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Für die AR-Ansicht und die Vor-Ort-Aufnahme wird die Kamera genutzt.</string>
```

Für echtes AR-Welttracking (WebXR/ARCore/ARKit) sind zusätzliche Plugins/
Konfiguration nötig; das Magic-Window (Kamera + Lagesensor) läuft ohne.

---

## App-Kennung

`appId` ist `de.raumwerk.app`, `appName` „RAUMWERK" (in
`capacitor.config.json` anpassbar). Icons/Splash werden am besten mit
`@capacitor/assets` aus einem Quellbild erzeugt.
