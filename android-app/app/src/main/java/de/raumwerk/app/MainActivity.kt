package de.raumwerk.app

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.view.KeyEvent
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import java.io.File

/**
 * RAUMWERK für Android – eine dünne, aber vollwertige Hülle um die Web-App.
 *
 * Die App lädt **offline** aus den gebündelten Assets, aber über einen
 * virtuellen HTTPS-Origin (WebViewAssetLoader). Das ist wichtig: nur so laden
 * die ES-Module und nur so ist es ein sicherer Kontext, in dem Kamera und
 * Sensoren (AR, Scan) laufen. Kein Netz nötig.
 *
 * Über [NativeBridge] (`AndroidNative`) bekommt die Web-App echten Zugriff auf
 * Lage-, Orts- und Kamerasensorik – deutlich mehr, als ein Browser hergibt.
 *
 * Was eine nackte WebView *nicht* kann, ergänzt diese Activity: Dateiauswahl
 * und Kamerafoto für `<input type=file>`, das Kamerarecht für getUserMedia,
 * Lautstärketasten als Auslöser und eine Zurück-Taste, die zuerst die
 * Web-App fragt (offenes Blatt schließen statt App beenden).
 *
 * Geladen wird die eigenständige Feld-Oberfläche `raumwerk/mobil/` im
 * Ziegelwerk-Design – nicht die PC-Oberfläche im Kleinen.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var bruecke: NativeBridge
    private var sensorikGewollt = false

    // <input type=file>: der Rückruf der WebView und ggf. das Ziel fürs Kamerafoto.
    private var dateiRueckruf: ValueCallback<Array<Uri>>? = null
    private var fotoDatei: File? = null

    // getUserMedia wartet auf das Kamerarecht; Android fragt nur einmal zur Zeit.
    private var offeneKameraAnfrage: PermissionRequest? = null
    private var rechteDialogOffen = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Debug-Builds per chrome://inspect untersuchbar – die Web-App läuft sonst blind.
        WebView.setWebContentsDebuggingEnabled((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0)

        rechteAnfragen()

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
            )
            with(settings) {
                javaScriptEnabled = true
                domStorageEnabled = true                 // localStorage – der Projektspeicher
                mediaPlaybackRequiresUserGesture = false // Kamera-Stream ohne Extra-Tipp
                cacheMode = WebSettings.LOAD_DEFAULT
                allowFileAccess = false                  // alles kommt über den Asset-Origin
                setSupportZoom(false)                    // App, keine Webseite: kein Pinch-Zoom
            }
            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    loader.shouldInterceptRequest(request.url)

                override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    bruecke.seiteNeu()
                }
            }
            webChromeClient = object : WebChromeClient() {
                // Kamera-Anfragen der Web-App (getUserMedia) durchreichen.
                override fun onPermissionRequest(request: PermissionRequest) {
                    runOnUiThread { kameraFuerWeb(request) }
                }

                override fun onPermissionRequestCanceled(request: PermissionRequest) {
                    if (offeneKameraAnfrage === request) offeneKameraAnfrage = null
                }

                // Ohne das tut <input type=file> in einer WebView schlicht nichts.
                override fun onShowFileChooser(
                    view: WebView, rueckruf: ValueCallback<Array<Uri>>, params: FileChooserParams
                ): Boolean = dateiWahl(rueckruf, params)
            }
        }

        bruecke = NativeBridge(this, web, loader)
        web.addJavascriptInterface(bruecke, "AndroidNative")
        setContentView(web)

        // Eigenständige, für das Smartphone gebaute Oberfläche (nicht die
        // Desktop-Seite im Kleinen). Die PC-Ansicht bleibt unter raumwerk/.
        web.loadUrl("https://appassets.androidplatform.net/raumwerk/mobil/index.html")
    }

    // ------------------------------------------------------- Rechte

    private fun rechteAnfragen() {
        val fehlt = arrayOf(
            Manifest.permission.CAMERA,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ).filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (fehlt.isNotEmpty()) {
            rechteDialogOffen = true
            requestPermissions(fehlt.toTypedArray(), RECHT_START)
        }
    }

    private fun kameraFrei() =
        checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    /** getUserMedia: nur Video freigeben (Ton braucht die App nicht). */
    private fun kameraFuerWeb(request: PermissionRequest) {
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE !in request.resources) {
            request.deny()
            return
        }
        if (kameraFrei()) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
            return
        }
        offeneKameraAnfrage?.deny()
        offeneKameraAnfrage = request
        // Läuft schon der Start-Dialog (er fragt CAMERA mit), auf dessen Antwort
        // warten – eine zweite Anfrage würde Android sofort als Abbruch melden.
        if (!rechteDialogOffen) {
            rechteDialogOffen = true
            requestPermissions(arrayOf(Manifest.permission.CAMERA), RECHT_KAMERA)
        }
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, ergebnis: IntArray) {
        super.onRequestPermissionsResult(code, perms, ergebnis)
        rechteDialogOffen = false
        // Eine wartende Kamera-Anfrage der Web-App genau einmal beantworten.
        offeneKameraAnfrage?.let { a ->
            offeneKameraAnfrage = null
            if (kameraFrei()) a.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else a.deny()
        }
        // Nach erteiltem Ortungsrecht die Sensorik neu anwerfen, damit GPS greift.
        if (sensorikGewollt) bruecke.starteSensorik()
    }

    // ------------------------------------------------------- Dateiauswahl / Kamerafoto

    private fun dateiWahl(rueckruf: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
        // Ein noch offener Rückruf muss beendet werden, sonst bleibt das <input> tot.
        dateiRueckruf?.onReceiveValue(null)
        dateiRueckruf = rueckruf
        fotoDatei = null

        val typen = params.acceptTypes.orEmpty().map { it.trim().lowercase() }.filter { it.isNotEmpty() }
        val bilder = typen.any { it.startsWith("image/") }
        val nurBilder = typen.isNotEmpty() && typen.all { it.startsWith("image/") }

        val waehlen = params.createIntent().apply {
            // Endungen wie ".json"/".ply" sind keine MIME-Typen, und viele
            // Dateimanager melden JSON als octet-stream → sonst wäre die Datei grau.
            // Was gewählt wurde, prüft die Web-App ohnehin selbst.
            type = if (nurBilder) "image/*" else "*/*"
            if (params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        // Mit erklärtem, aber nicht erteiltem CAMERA-Recht wirft ACTION_IMAGE_CAPTURE.
        val kamera = if (bilder && kameraFrei()) kameraIntent() else null

        val versuche = when {
            kamera != null && params.isCaptureEnabled -> listOf(kamera, waehlen)
            kamera != null -> listOf(
                Intent.createChooser(waehlen, "Bild wählen")
                    .putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(kamera)),
                waehlen,
            )
            else -> listOf(waehlen)
        }
        for (i in versuche) {
            try {
                startActivityForResult(i, DATEI_WAHL)
                return true
            } catch (_: ActivityNotFoundException) {
                // nächsten Weg probieren
            }
        }
        // false → die WebView bricht selbst ab; den Rückruf dann nicht mehr rufen.
        dateiRueckruf = null
        fotoDatei = null
        return false
    }

    private fun kameraIntent(): Intent? {
        val uri = try {
            val ordner = File(cacheDir, "fotos").apply { mkdirs() }
            NativeBridge.alteDateienWeg(ordner)
            val datei = File(ordner, "foto-${System.currentTimeMillis()}.jpg")
            fotoDatei = datei
            FileProvider.getUriForFile(this, NativeBridge.autoritaet(this), datei)
        } catch (_: Exception) {
            fotoDatei = null
            return null
        }
        return Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            clipData = ClipData.newRawUri("foto", uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != DATEI_WAHL) {
            super.onActivityResult(requestCode, resultCode, data)
            return
        }
        val rueckruf = dateiRueckruf ?: return
        dateiRueckruf = null
        val foto = fotoDatei
        fotoDatei = null

        var uris: Array<Uri>? = null
        if (resultCode == RESULT_OK) {
            val clip = data?.clipData
            uris = when {
                // Die Kamera schreibt in unsere Datei und liefert meist keine Daten zurück.
                foto != null && foto.length() > 0 ->
                    arrayOf(FileProvider.getUriForFile(this, NativeBridge.autoritaet(this), foto))
                clip != null && clip.itemCount > 0 ->
                    (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }.toTypedArray()
                else -> WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            }
            if (uris != null && uris.isEmpty()) uris = null
        }
        rueckruf.onReceiveValue(uris) // genau einmal, null = abgebrochen
    }

    // ------------------------------------------------------- Lebenszyklus

    override fun onResume() {
        super.onResume()
        web.onResume()
        sensorikGewollt = true
        bruecke.fortsetzen()
    }

    override fun onPause() {
        bruecke.pausieren()
        web.onPause()
        super.onPause()
    }

    // ------------------------------------------------------- Tasten

    /** Lautstärketasten als Auslöser, solange die Web-App sie fängt. */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val k = event.keyCode
        if (bruecke.tastenGefangen && (k == KeyEvent.KEYCODE_VOLUME_DOWN || k == KeyEvent.KEYCODE_VOLUME_UP)) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                val welche = if (k == KeyEvent.KEYCODE_VOLUME_DOWN) "leiser" else "lauter"
                web.evaluateJavascript("window.__native && window.__native._taste('$welche')", null)
            }
            return true // DOWN und UP verbrauchen – sonst ändert sich doch die Lautstärke
        }
        return super.dispatchKeyEvent(event)
    }

    /**
     * Zurück: zuerst die Web-App fragen (offenes Blatt, Dialog …). Erst wenn
     * sie ablehnt, in der Verlaufsliste zurück – und ganz am Anfang raus.
     */
    @Deprecated("Klassische Zurück-Taste – die Web-App entscheidet zuerst")
    override fun onBackPressed() {
        web.evaluateJavascript(
            "window.__native && window.__native._zurueck ? window.__native._zurueck() : false"
        ) { ergebnis ->
            if (ergebnis == "true") return@evaluateJavascript
            if (web.canGoBack()) web.goBack() else zurueckRaus()
        }
    }

    @Suppress("DEPRECATION")
    private fun zurueckRaus() = super.onBackPressed()

    companion object {
        private const val RECHT_START = 1
        private const val RECHT_KAMERA = 2
        private const val DATEI_WAHL = 41
    }
}
