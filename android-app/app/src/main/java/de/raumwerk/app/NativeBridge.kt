package de.raumwerk.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * NativeBridge – die echte Hardware unter der Web-App.
 *
 * Als `AndroidNative` in die WebView eingehängt, gibt diese Klasse dem
 * JavaScript Zugriff auf das, was ein Browser nicht (zuverlässig) kann:
 *
 *  · **Lage** aus dem Rotationsvektor (Beschleunigung + Gyroskop + Magnetfeld
 *    fusioniert) – Kompass-Azimut, Neigung, Roll und ein sauberes Quaternion.
 *  · **Lage zum Messen** aus dem Spiel-Rotationsvektor (ohne Magnetometer) –
 *    Stromleitungen und Stahlträger verbiegen dort die Zielrichtung nicht.
 *  · **Ort** über GPS/Netz (Länge, Breite, Höhe, Genauigkeit).
 *  · **Geräte-Steckbrief**: jede physische Kamera (auch Mono-/IR-Linsen und die
 *    Einzellinsen einer logischen Multi-Kamera) samt Brennweiten, dazu die
 *    komplette Sensorliste. Der Scan-Assistent nutzt das, um die beste Kamera
 *    zu wählen und die Laufwege zu führen.
 *  · **Lautstärketasten** als Auslöser, **Teilen** über das Android-Menü und
 *    **Drucken / PDF** über den Druckdienst (window.print() tut in einer
 *    WebView nichts).
 *
 * Sensor-Callbacks brauchen einen Looper; die @JavascriptInterface-Methoden
 * laufen aber auf einem Binder-Thread. Darum wird jede Registrierung und jeder
 * `evaluateJavascript`-Aufruf über `web.post{…}` auf den UI-Thread geschoben.
 */
class NativeBridge(
    private val ctx: Activity,
    private val web: WebView,
    private val lader: WebViewAssetLoader,
) : SensorEventListener, LocationListener {

    private val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager?
    private val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager?

    private val rot = FloatArray(9)
    private val orient = FloatArray(3)
    private val quat = FloatArray(4) // [w, x, y, z]
    @Volatile private var laeuft = false
    private var letzterOrientPush = 0L
    private var gpsAktiv = false
    private var netzAktiv = false

    // Lage zum Messen: eigener Hörer (nicht `this`). Fehlt der Spiel-Rotations-
    // vektor, ist es derselbe Sensor wie für „Orient" – ein Hörer könnte ihn
    // nicht doppelt anmelden, und stoppeSensorik() würde beide abklemmen.
    private var lageGewollt = false   // JS hat starteLage() gerufen
    private var lageAktiv = false     // Hörer ist wirklich angemeldet
    private var pausiert = false      // Activity im Hintergrund → nichts anmelden
    private val quatLage = FloatArray(4)
    private var letzterLagePush = 0L
    // Epoche der Lage: zählt bei jedem (Wieder-)Anmelden des Hörers hoch. Der
    // Spiel-Rotationsvektor startet dabei frisch (AOSP-Fusion: neue Gier-Null je
    // nach Haltung) – Blickrichtungen verschiedener Epochen passen nicht
    // zusammen. JS (ar.js, assistent.js) richtet bei einem Wechsel neu aus.
    private var lageEpoche = 0
    private val lageHoerer = object : SensorEventListener {
        override fun onSensorChanged(e: SensorEvent) = lageEmpfangen(e)
        override fun onAccuracyChanged(s: Sensor?, a: Int) {}
    }

    /** Lautstärketasten an die Web-App statt an die Lautstärke (MainActivity liest das). */
    @Volatile var tastenGefangen = false
        private set

    // Druck-WebView: muss leben, bis der Druckdienst den Adapter übernommen hat.
    private var druckAnsicht: WebView? = null

    // ------------------------------------------------------- Steuerung (JS → nativ)

    @JavascriptInterface
    fun starteSensorik() {
        web.post { sensorikAn() }
    }

    @JavascriptInterface
    fun stoppeSensorik() {
        web.post { sensorikAus() }
    }

    /** Lage zum Messen (Spiel-Rotationsvektor, ohne Magnetometer) anwerfen. */
    @JavascriptInterface
    fun starteLage() {
        web.post {
            lageGewollt = true
            lageAn()
        }
    }

    @JavascriptInterface
    fun stoppeLage() {
        web.post {
            lageGewollt = false
            lageAus()
        }
    }

    /** Lautstärketasten fangen (true) oder wieder dem System lassen (false). */
    @JavascriptInterface
    fun tastenFangen(an: Boolean) {
        tastenGefangen = an
    }

    /**
     * Text als Datei über das Android-Teilen-Menü weitergeben (Mail, Messenger,
     * Dateien). Die Datei liegt im Cache und wird per FileProvider freigegeben.
     * `true`, wenn das Menü gestartet wurde.
     */
    @JavascriptInterface
    fun teilen(name: String?, mime: String?, inhalt: String?): Boolean {
        val uri = try {
            val ordner = File(ctx.cacheDir, "teilen").apply { mkdirs() }
            alteDateienWeg(ordner)
            val datei = File(ordner, dateiname(name ?: ""))
            datei.writeText(inhalt ?: "", Charsets.UTF_8)
            FileProvider.getUriForFile(ctx, autoritaet(ctx), datei)
        } catch (_: Exception) {
            return false
        }
        val senden = Intent(Intent.ACTION_SEND).apply {
            type = mime?.takeIf { it.contains('/') } ?: "application/octet-stream"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, uri.lastPathSegment)
            clipData = ClipData.newUri(ctx.contentResolver, uri.lastPathSegment, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val wahl = Intent.createChooser(senden, "Teilen")
        return aufUi(false) {
            try { ctx.startActivity(wahl); true } catch (_: ActivityNotFoundException) { false }
        }
    }

    /**
     * HTML drucken bzw. als PDF sichern – über den Android-Druckdienst
     * („Als PDF speichern"). Eine eigene, unsichtbare WebView rendert das
     * Dokument; Schriften und Bilder lädt sie über denselben Asset-Origin.
     */
    @JavascriptInterface
    fun drucken(html: String?, titel: String?): Boolean {
        if (html.isNullOrEmpty()) return false
        web.post {
            val wv = WebView(ctx)
            druckAnsicht = wv
            // Ohne JavaScript: der Report ist reines HTML/SVG, und so kann
            // eingebetteter Nutzertext dort nichts ausführen.
            wv.settings.javaScriptEnabled = false
            wv.webViewClient = object : WebViewClientCompat() {
                private var gedruckt = false
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    lader.shouldInterceptRequest(request.url)

                override fun onPageFinished(view: WebView, url: String?) {
                    if (gedruckt) return
                    gedruckt = true
                    val pm = ctx.getSystemService(Context.PRINT_SERVICE) as PrintManager
                    val name = titel?.takeIf { it.isNotBlank() } ?: "RAUMWERK"
                    pm.print(
                        name, view.createPrintDocumentAdapter(name),
                        PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build()
                    )
                }
            }
            wv.loadDataWithBaseURL("https://appassets.androidplatform.net/", html, "text/html", "utf-8", null)
        }
        return true
    }

    /** Vollständiger Geräte-Steckbrief als JSON-Text (JS parst ihn). */
    @JavascriptInterface
    fun geraeteInfo(): String {
        val o = JSONObject()
        o.put("hersteller", Build.MANUFACTURER)
        o.put("modell", Build.MODEL)
        o.put("android", Build.VERSION.RELEASE)
        o.put("sdk", Build.VERSION.SDK_INT)
        o.put("kameras", kameraListe())
        o.put("sensoren", sensorListe())
        return o.toString()
    }

    // ------------------------------------------------------- Steuerung (Activity → nativ)

    /** onPause: alles abmelden; ob JS die Lage wollte, bleibt gemerkt. */
    fun pausieren() {
        web.post {
            pausiert = true
            sensorikAus()
            lageAus()
        }
    }

    /** onResume: Sensorik wieder an, die Lage nur, wenn JS sie gestartet hatte (neue Epoche). */
    fun fortsetzen() {
        web.post {
            pausiert = false
            sensorikAn()
            if (lageGewollt) lageAn()
        }
    }

    /** Neue Seite geladen: deren JS-Hörer sind weg, also Tasten und Lage freigeben. */
    fun seiteNeu() {
        tastenGefangen = false
        web.post {
            lageGewollt = false
            lageAus()
        }
    }

    // ------------------------------------------------------- An-/Abmelden (UI-Thread)

    private fun sensorikAn() {
        if (pausiert) return
        if (!laeuft) {
            laeuft = true
            sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
                ?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
        }
        // Ort getrennt je Anbieter: wird das Recht erst später erteilt (oder nur
        // „ungefähr"), greift der nächste Aufruf trotzdem noch.
        val l = lm ?: return
        try {
            if (!gpsAktiv && l.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                l.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this)
                gpsAktiv = true
            }
        } catch (_: SecurityException) {
            // Kein genaues Ortungsrecht – Lage funktioniert trotzdem.
        }
        try {
            if (!netzAktiv && l.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                l.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 2000L, 0f, this)
                netzAktiv = true
            }
        } catch (_: SecurityException) {}
    }

    private fun sensorikAus() {
        laeuft = false
        sm.unregisterListener(this)
        try { lm?.removeUpdates(this) } catch (_: SecurityException) {}
        gpsAktiv = false
        netzAktiv = false
    }

    private fun lageAn() {
        if (lageAktiv || pausiert) return
        // Spiel-Rotationsvektor = Gyroskop + Beschleunigung, ohne Magnetfeld.
        // Fehlt er (sehr alte Geräte), dann eben der normale Rotationsvektor.
        val s = sm.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
            ?: sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
            ?: return
        // 100 Hz abtasten, höchstens ~60 Hz an JS: so ist jeder Push frisch.
        lageAktiv = sm.registerListener(lageHoerer, s, 10_000)
        if (lageAktiv) lageEpoche++
    }

    private fun lageAus() {
        if (!lageAktiv) return
        sm.unregisterListener(lageHoerer)
        lageAktiv = false
    }

    // ------------------------------------------------------- Kamera/Sensoren

    private fun kameraListe(): JSONArray {
        val arr = JSONArray()
        val mgr = cm ?: return arr
        try {
            for (id in mgr.cameraIdList) {
                val c = mgr.getCameraCharacteristics(id)
                val k = JSONObject()
                k.put("id", id)
                k.put("richtung", when (c.get(CameraCharacteristics.LENS_FACING)) {
                    CameraCharacteristics.LENS_FACING_FRONT -> "vorne"
                    CameraCharacteristics.LENS_FACING_BACK -> "hinten"
                    else -> "extern"
                })
                c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.let { f ->
                    val b = JSONArray(); for (v in f) b.put(runde(v.toDouble(), 2)); k.put("brennweiten", b)
                }
                val caps = c.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)
                // Monochrom-Fähigkeit ist der beste standardisierte Hinweis auf eine
                // Mono-/IR-Linse (z. B. Nachtsicht). Kein Netz, kein Herstellertrick.
                if (Build.VERSION.SDK_INT >= 28 && caps != null)
                    k.put("mono", caps.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MONOCHROME))
                if (Build.VERSION.SDK_INT >= 28) {
                    val phys = c.physicalCameraIds
                    if (phys.isNotEmpty()) k.put("physisch", JSONArray(phys.toList()))
                }
                arr.put(k)
            }
        } catch (_: Exception) {
            // Kamerazugriff kann herstellerabhängig zicken – dann eben leere Liste.
        }
        return arr
    }

    private fun sensorListe(): JSONArray {
        val arr = JSONArray()
        for (s in sm.getSensorList(Sensor.TYPE_ALL)) {
            arr.put(JSONObject()
                .put("name", s.name)
                .put("typ", s.type)
                .put("hersteller", s.vendor))
        }
        return arr
    }

    // ------------------------------------------------------- Sensor-Callbacks

    override fun onSensorChanged(e: SensorEvent) {
        if (e.sensor.type != Sensor.TYPE_ROTATION_VECTOR) return
        val now = System.currentTimeMillis()
        if (now - letzterOrientPush < 33) return // ~30 Hz reichen fürs UI
        letzterOrientPush = now
        SensorManager.getRotationMatrixFromVector(rot, e.values)
        SensorManager.getOrientation(rot, orient)
        SensorManager.getQuaternionFromVector(quat, e.values) // [w, x, y, z]
        // Richtung der RÜCKKAMERA (Geräte-−Z in Weltkoordinaten), nicht der
        // Oberkante: getOrientation()[0] kippt weg, sobald das Handy hochkant
        // steht – genau die Haltung beim Fotografieren und Zielen.
        val ost = -rot[2].toDouble()
        val nord = -rot[5].toDouble()
        var az = if (Math.hypot(ost, nord) > 0.05) Math.toDegrees(Math.atan2(ost, nord))
            else Math.toDegrees(orient[0].toDouble())
        if (az < 0) az += 360.0
        val j = "{" +
            "\"azimut\":${z(az)}," +
            "\"neigung\":${z(Math.toDegrees(orient[1].toDouble()))}," +
            "\"roll\":${z(Math.toDegrees(orient[2].toDouble()))}," +
            "\"kameraNeigung\":${z(Math.toDegrees(Math.asin((-rot[8].toDouble()).coerceIn(-1.0, 1.0))))}," +
            "\"q\":[${z(quat[0].toDouble())},${z(quat[1].toDouble())},${z(quat[2].toDouble())},${z(quat[3].toDouble())}]}"
        anJs("Orient", j)
    }

    override fun onAccuracyChanged(s: Sensor?, a: Int) {}

    /** Lage zum Messen: Quaternion (feiner aufgelöst, schneller) und seine Epoche. */
    private fun lageEmpfangen(e: SensorEvent) {
        val t = e.sensor.type
        if (t != Sensor.TYPE_GAME_ROTATION_VECTOR && t != Sensor.TYPE_ROTATION_VECTOR) return
        val now = SystemClock.elapsedRealtime()
        if (now - letzterLagePush < 16) return // ~60 Hz
        letzterLagePush = now
        SensorManager.getQuaternionFromVector(quatLage, e.values) // [w, x, y, z]
        val j = "{\"qs\":[${z(quatLage[0].toDouble(), 6)},${z(quatLage[1].toDouble(), 6)}," +
            "${z(quatLage[2].toDouble(), 6)},${z(quatLage[3].toDouble(), 6)}],\"epoche\":$lageEpoche}"
        anJs("Lage", j)
    }

    // ------------------------------------------------------- Orts-Callbacks

    override fun onLocationChanged(l: Location) {
        val j = "{" +
            "\"breite\":${z(l.latitude)},\"laenge\":${z(l.longitude)}," +
            "\"hoehe\":${if (l.hasAltitude()) z(l.altitude) else "null"}," +
            "\"genauigkeit\":${z(l.accuracy.toDouble())}," +
            "\"quelle\":\"${l.provider ?: "?"}\",\"zeit\":${l.time}}"
        anJs("Ort", j)
    }

    // Vor Android 11 abstrakt – muss bleiben, sonst AbstractMethodError.
    @Deprecated("Nur für Android < 11 nötig")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}

    // ------------------------------------------------------- Hilfen

    private fun anJs(name: String, json: String) {
        val js = "window.__native && window.__native._empfange$name($json)"
        web.post { web.evaluateJavascript(js, null) }
    }

    /**
     * Block auf dem UI-Thread ausführen und auf sein Ergebnis warten. Nur aus
     * @JavascriptInterface-Methoden (Binder-Thread) rufen – nie vom UI-Thread.
     */
    private fun <T> aufUi(standard: T, block: () -> T): T {
        val fertig = CountDownLatch(1)
        var wert = standard
        web.post {
            try { wert = block() } finally { fertig.countDown() }
        }
        return if (fertig.await(3, TimeUnit.SECONDS)) wert else standard
    }

    /** JSON-sicher: NaN/Inf werden zu 0, sonst n (Standard 4) Nachkommastellen. */
    private fun z(d: Double, n: Int = 4): String {
        if (d.isNaN() || d.isInfinite()) return "0"
        return String.format(Locale.US, "%.${n}f", d)
    }
    private fun runde(d: Double, n: Int): Double {
        val f = Math.pow(10.0, n.toDouble())
        return Math.round(d * f) / f
    }

    companion object {
        /** FileProvider-Autorität, passend zum <provider> im Manifest. */
        fun autoritaet(ctx: Context) = "${ctx.packageName}.dateien"

        /** Dateiname ohne Pfadtrenner und Steuerzeichen – nie aus dem Ordner heraus. */
        fun dateiname(name: String): String {
            val sauber = name.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").trim().trimStart('.')
            return sauber.takeLast(120).ifBlank { "raumwerk-export.txt" }
        }

        /** Geteilte Dateien und Kamerafotos nach einem Tag aus dem Cache räumen. */
        fun alteDateienWeg(ordner: File) {
            val grenze = System.currentTimeMillis() - 24L * 3600 * 1000
            ordner.listFiles()?.forEach { if (it.isFile && it.lastModified() < grenze) it.delete() }
        }
    }
}
