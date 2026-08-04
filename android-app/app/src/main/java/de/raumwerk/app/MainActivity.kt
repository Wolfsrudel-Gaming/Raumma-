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
 * Sensoren (AR) laufen. Kein Netz nötig; die Pipeline-Anbindung bleibt optional.
 *
 * Das eigene Design zieht die App über `?skin=werk` – ein dunkles Instrument-
 * Design, das sich klar von der hellen Weboberfläche unterscheidet.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.CAMERA), 1)
        }

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
        setContentView(web)

        web.loadUrl("https://appassets.androidplatform.net/raumwerk/index.html?skin=werk")
    }

    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}
