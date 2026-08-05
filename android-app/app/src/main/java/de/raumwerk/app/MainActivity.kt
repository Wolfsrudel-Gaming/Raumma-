package de.raumwerk.app

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

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
 * Das eigene Design zieht die App über `?skin=ziegel` – ein rustikaler
 * Backstein-Look, der sich klar von der hellen Weboberfläche unterscheidet.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var bruecke: NativeBridge
    private var sensorikGewollt = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

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
            }
            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    loader.shouldInterceptRequest(request.url)
            }
            // Kamera-Anfragen der Web-App (getUserMedia) durchreichen.
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    runOnUiThread { request.grant(request.resources) }
                }
            }
        }

        bruecke = NativeBridge(this, web)
        web.addJavascriptInterface(bruecke, "AndroidNative")
        setContentView(web)

        // Eigenständige, für das Smartphone gebaute Oberfläche (nicht die
        // Desktop-Seite im Kleinen). Die PC-Ansicht bleibt unter raumwerk/.
        web.loadUrl("https://appassets.androidplatform.net/raumwerk/mobil/index.html")
    }

    private fun rechteAnfragen() {
        val fehlt = arrayOf(
            Manifest.permission.CAMERA,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ).filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (fehlt.isNotEmpty()) requestPermissions(fehlt.toTypedArray(), 1)
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, ergebnis: IntArray) {
        super.onRequestPermissionsResult(code, perms, ergebnis)
        // Nach erteiltem Ortungsrecht die Sensorik neu anwerfen, damit GPS greift.
        if (sensorikGewollt) bruecke.starteSensorik()
    }

    override fun onResume() {
        super.onResume()
        sensorikGewollt = true
        bruecke.starteSensorik()
    }

    override fun onPause() {
        bruecke.stoppeSensorik()
        super.onPause()
    }

    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}
