plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "de.raumwerk.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "de.raumwerk.app"
        minSdk = 26            // Android 8 – reicht für Adaptive Icons und WebViewAssetLoader
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // Nur die WebView-Erweiterungen: AssetLoader (virtueller HTTPS-Origin →
    // ES-Module + Kamera funktionieren) und WebViewClientCompat.
    implementation("androidx.webkit:webkit:1.11.0")
}

// Die Web-App VOR dem Build nach assets/ kopieren – so ist die App die eine
// Quelle für Web und Android. Tests werden ausgelassen.
val kopiereWeb by tasks.registering(Copy::class) {
    from(rootProject.file("../web")) {
        exclude("tests/**", "**/.DS_Store")
    }
    into(layout.projectDirectory.dir("src/main/assets"))
}
tasks.named("preBuild") { dependsOn(kopiereWeb) }
