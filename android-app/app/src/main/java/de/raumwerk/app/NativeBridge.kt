package de.raumwerk.app

import android.content.Context
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
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * NativeBridge – die echte Hardware unter der Web-App.
 *
 * Als `AndroidNative` in die WebView eingehängt, gibt diese Klasse dem
 * JavaScript Zugriff auf das, was ein Browser nicht (zuverlässig) kann:
 *
 *  · **Lage** aus dem Rotationsvektor (Beschleunigung + Gyroskop + Magnetfeld
 *    fusioniert) – Kompass-Azimut, Neigung, Roll und ein sauberes Quaternion.
 *  · **Ort** über GPS/Netz (Länge, Breite, Höhe, Genauigkeit).
 *  · **Geräte-Steckbrief**: jede physische Kamera (auch Mono-/IR-Linsen und die
 *    Einzellinsen einer logischen Multi-Kamera) samt Brennweiten, dazu die
 *    komplette Sensorliste. Der Scan-Assistent nutzt das, um die beste Kamera
 *    zu wählen und die Laufwege zu führen.
 *
 * Sensor-Callbacks brauchen einen Looper; die @JavascriptInterface-Methoden
 * laufen aber auf einem Binder-Thread. Darum wird jede Registrierung und jeder
 * `evaluateJavascript`-Aufruf über `web.post{…}` auf den UI-Thread geschoben.
 */
class NativeBridge(private val ctx: Context, private val web: WebView) :
    SensorEventListener, LocationListener {

    private val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager?
    private val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager?

    private val rot = FloatArray(9)
    private val orient = FloatArray(3)
    private val quat = FloatArray(4) // [w, x, y, z]
    @Volatile private var laeuft = false
    private var letzterOrientPush = 0L

    // ------------------------------------------------------- Steuerung (JS → nativ)

    @JavascriptInterface
    fun starteSensorik() {
        web.post {
            if (laeuft) return@post
            laeuft = true
            sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
                ?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
            try {
                lm?.let { l ->
                    if (l.isProviderEnabled(LocationManager.GPS_PROVIDER))
                        l.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this)
                    if (l.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                        l.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 2000L, 0f, this)
                }
            } catch (_: SecurityException) {
                // Ortungsrecht (noch) nicht erteilt – Lage funktioniert trotzdem.
            }
        }
    }

    @JavascriptInterface
    fun stoppeSensorik() {
        web.post {
            laeuft = false
            sm.unregisterListener(this)
            try { lm?.removeUpdates(this) } catch (_: SecurityException) {}
        }
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
        var az = Math.toDegrees(orient[0].toDouble())
        if (az < 0) az += 360.0
        val j = "{" +
            "\"azimut\":${z(az)}," +
            "\"neigung\":${z(Math.toDegrees(orient[1].toDouble()))}," +
            "\"roll\":${z(Math.toDegrees(orient[2].toDouble()))}," +
            "\"q\":[${z(quat[0].toDouble())},${z(quat[1].toDouble())},${z(quat[2].toDouble())},${z(quat[3].toDouble())}]}"
        anJs("Orient", j)
    }

    override fun onAccuracyChanged(s: Sensor?, a: Int) {}

    // ------------------------------------------------------- Orts-Callbacks

    override fun onLocationChanged(l: Location) {
        val j = "{" +
            "\"breite\":${z(l.latitude)},\"laenge\":${z(l.longitude)}," +
            "\"hoehe\":${if (l.hasAltitude()) z(l.altitude) else "null"}," +
            "\"genauigkeit\":${z(l.accuracy.toDouble())}," +
            "\"quelle\":\"${l.provider ?: "?"}\",\"zeit\":${l.time}}"
        anJs("Ort", j)
    }

    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}

    // ------------------------------------------------------- Hilfen

    private fun anJs(name: String, json: String) {
        val js = "window.__native && window.__native._empfange$name($json)"
        web.post { web.evaluateJavascript(js, null) }
    }

    /** JSON-sicher: NaN/Inf werden zu 0, sonst 4 Nachkommastellen. */
    private fun z(d: Double): String {
        if (d.isNaN() || d.isInfinite()) return "0"
        return String.format(Locale.US, "%.4f", d)
    }
    private fun runde(d: Double, n: Int): Double {
        val f = Math.pow(10.0, n.toDouble())
        return Math.round(d * f) / f
    }
}
