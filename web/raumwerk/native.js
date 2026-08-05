/*
 * window.__native – die Brücke zur Gerätehardware.
 *
 * In der Android-App liefert `AndroidNative` (siehe NativeBridge.kt) echte
 * Lage-, Orts- und Kameradaten. Im normalen Browser gibt es das nicht; dann
 * fällt diese Schicht sauber auf die Web-APIs zurück (DeviceOrientation,
 * Geolocation, enumerateDevices). Der Rest der App programmiert nur gegen
 * `window.__native` und muss den Unterschied nicht kennen.
 *
 * Bewusst ein klassisches Script (kein Modul): so steht `window.__native`
 * schon bereit, bevor die ES-Module starten.
 */
(function () {
  "use strict";
  var A = window.AndroidNative || null;

  var N = {
    app: !!A,                    // läuft in der nativen App?
    wertOrient: null,            // { azimut, neigung, roll, q:[w,x,y,z] }
    wertOrt: null,               // { breite, laenge, hoehe, genauigkeit, quelle, zeit }
    _info: null,
    _orientHörer: [],
    _ortHörer: [],

    // ---- Abfragen -------------------------------------------------------
    orientierung: function () { return this.wertOrient; },
    ort: function () { return this.wertOrt; },

    /** Geräte-Steckbrief (Kameras, Sensoren). Wird einmal gelesen und gemerkt. */
    geraete: function () {
      if (this._info) return this._info;
      if (A) { try { this._info = JSON.parse(A.geraeteInfo()); } catch (e) { this._info = null; } }
      return this._info;
    },

    // ---- Abonnements ----------------------------------------------------
    beiOrient: function (cb) { this._orientHörer.push(cb); if (this.wertOrient) cb(this.wertOrient); },
    beiOrt: function (cb) { this._ortHörer.push(cb); if (this.wertOrt) cb(this.wertOrt); },

    // ---- von Kotlin gerufen --------------------------------------------
    _empfangeOrient: function (o) {
      this.wertOrient = o;
      for (var i = 0; i < this._orientHörer.length; i++) { try { this._orientHörer[i](o); } catch (e) {} }
    },
    _empfangeOrt: function (o) {
      this.wertOrt = o;
      for (var i = 0; i < this._ortHörer.length; i++) { try { this._ortHörer[i](o); } catch (e) {} }
    },

    // ---- Steuerung ------------------------------------------------------
    starte: function () { if (A) { try { A.starteSensorik(); } catch (e) {} } else webFallback(this); },
    stoppe: function () { if (A) { try { A.stoppeSensorik(); } catch (e) {} } }
  };

  // ---- Web-Rückfall (Browser ohne native Brücke) ------------------------
  var fallbackLäuft = false;
  function webFallback(self) {
    if (fallbackLäuft) return;
    fallbackLäuft = true;
    var DOE = window.DeviceOrientationEvent;
    function anmelden() {
      window.addEventListener("deviceorientation", function (e) {
        if (e.alpha == null) return;
        // alpha ist im Web der Kompass-Azimut (0 = Nord), beta = Neigung.
        self._empfangeOrient({ azimut: e.alpha, neigung: e.beta, roll: e.gamma, q: null });
      });
    }
    if (DOE && typeof DOE.requestPermission === "function") {
      // iOS: Recht erst nach Nutzergeste – wird beim ersten Start eingeholt.
      DOE.requestPermission().then(function (s) { if (s === "granted") anmelden(); }).catch(function () {});
    } else if (DOE) {
      anmelden();
    }
    if (navigator.geolocation) {
      try {
        navigator.geolocation.watchPosition(function (p) {
          self._empfangeOrt({
            breite: p.coords.latitude, laenge: p.coords.longitude,
            hoehe: p.coords.altitude, genauigkeit: p.coords.accuracy,
            quelle: "web", zeit: p.timestamp
          });
        }, function () {}, { enableHighAccuracy: true, maximumAge: 2000 });
      } catch (e) {}
    }
  }

  // Im Browser den Steckbrief aus enumerateDevices nachbilden (Kameraliste).
  if (!A && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    navigator.mediaDevices.enumerateDevices().then(function (list) {
      var kams = list.filter(function (d) { return d.kind === "videoinput"; })
        .map(function (d, i) { return { id: d.deviceId, richtung: /front/i.test(d.label) ? "vorne" : "hinten", etikett: d.label || ("Kamera " + (i + 1)) }; });
      N._info = { hersteller: "Browser", modell: navigator.userAgent, kameras: kams, sensoren: [] };
    }).catch(function () {});
  }

  window.__native = N;
  if (A) N.starte();   // in der App sofort; im Browser erst bei Bedarf (Geste)
})();
