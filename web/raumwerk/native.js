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
    wertOrient: null,            // { azimut (Kamerarichtung), neigung, roll, kameraNeigung, q:[w,x,y,z] }
    wertOrt: null,               // { breite, laenge, hoehe, genauigkeit, quelle, zeit }
    wertLage: null,              // { qs:[w,x,y,z], epoche } (App) oder { euler:[α,β,γ] } (Web)
    _info: null,
    _orientHörer: [],
    _ortHörer: [],
    _lageHörer: [],
    _tastenHörer: [],
    _zurueckHörer: [],

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

    /**
     * Lage zum **Messen** (Zielen): ohne Magnetometer, damit Stromleitungen,
     * Stahlträger und Heizkörper die Richtung nicht verbiegen. In der App der
     * Spiel-Rotationsvektor (Gyroskop + Beschleunigung) als Quaternion `qs`,
     * im Browser `deviceorientation` (in Chrome relativ, also ebenfalls ohne
     * Kompass) als `euler`. Gibt eine Abmeldefunktion zurück.
     *
     * `epoche` (nur App, unverändert aus NativeBridge.kt durchgereicht): zählt
     * hoch, sobald der Sensor neu angemeldet wurde (z. B. nach Pause/Rückkehr).
     * Dann zählt die Gier ab einer neuen Null – Richtungen verschiedener
     * Epochen gehören nicht in eine Rechnung. Im Browser fehlt sie (undefined)
     * und wechselt also nie.
     */
    beiLage: function (cb) {
      var self = this;
      this._lageHörer.push(cb);
      if (this._lageHörer.length === 1) {
        if (A && typeof A.starteLage === "function") { try { A.starteLage(); } catch (e) {} }
        else webLage(this);
      }
      return function () {
        var i = self._lageHörer.indexOf(cb);
        if (i >= 0) self._lageHörer.splice(i, 1);
        if (!self._lageHörer.length) {
          if (A && typeof A.stoppeLage === "function") { try { A.stoppeLage(); } catch (e) {} }
          else webLageStopp();
        }
      };
    },

    /**
     * Lautstärketasten als Auslöser (App): Wer beim Zielen auf den Schirm
     * tippt, verwackelt genau den Punkt, um den es geht. Gibt eine
     * Abmeldefunktion zurück; im Browser ohne Wirkung.
     */
    beiTaste: function (cb) {
      var self = this;
      this._tastenHörer.push(cb);
      if (A && typeof A.tastenFangen === "function") { try { A.tastenFangen(true); } catch (e) {} }
      return function () {
        var i = self._tastenHörer.indexOf(cb);
        if (i >= 0) self._tastenHörer.splice(i, 1);
        if (!self._tastenHörer.length && A && typeof A.tastenFangen === "function") { try { A.tastenFangen(false); } catch (e) {} }
      };
    },

    /**
     * Zurück-Taste (App): Hörer, der `true` liefert, hat sie verbraucht
     * (z. B. ein offenes Blatt geschlossen). Der zuletzt angemeldete zuerst.
     */
    beiZurueck: function (cb) {
      var self = this;
      this._zurueckHörer.push(cb);
      return function () { var i = self._zurueckHörer.indexOf(cb); if (i >= 0) self._zurueckHörer.splice(i, 1); };
    },

    /**
     * Eine Datei weitergeben (Export, Report). In der App über das
     * Android-Teilen-Menü (Mail, Messenger, Dateien); im Browser über die
     * Web-Share-API mit Datei, sonst als Download. Gibt ein Promise<boolean>.
     */
    teilen: function (name, mime, text) {
      if (A && typeof A.teilen === "function") {
        try { return Promise.resolve(!!A.teilen(name, mime, text)); } catch (e) { return Promise.resolve(false); }
      }
      try {
        var datei = (typeof File === "function") ? new File([text], name, { type: mime }) : null;
        if (datei && navigator.canShare && navigator.canShare({ files: [datei] }) && navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
          return navigator.share({ files: [datei], title: name }).then(function () { return true; }, function () { return herunterladen(name, mime, text); });
        }
      } catch (e) {}
      return Promise.resolve(herunterladen(name, mime, text));
    },

    /**
     * Ein HTML-Dokument drucken bzw. als PDF sichern. In der App über den
     * Android-Druckdienst („Als PDF speichern“); `false` heißt: der Aufrufer
     * nimmt den Browserweg (eigenes Fenster + window.print).
     */
    drucken: function (html, titel) {
      if (A && typeof A.drucken === "function") { try { return !!A.drucken(html, titel || "RAUMWERK"); } catch (e) {} }
      return false;
    },

    // ---- von Kotlin gerufen --------------------------------------------
    _empfangeOrient: function (o) {
      this.wertOrient = o;
      for (var i = 0; i < this._orientHörer.length; i++) { try { this._orientHörer[i](o); } catch (e) {} }
    },
    _empfangeLage: function (o) {
      this.wertLage = o;
      for (var i = 0; i < this._lageHörer.length; i++) { try { this._lageHörer[i](o); } catch (e) {} }
    },
    _taste: function (welche) {
      for (var i = this._tastenHörer.length - 1; i >= 0; i--) { try { this._tastenHörer[i](welche); } catch (e) {} }
    },
    /** Von der App bei der Zurück-Taste gerufen; true = verbraucht. */
    _zurueck: function () {
      for (var i = this._zurueckHörer.length - 1; i >= 0; i--) {
        try { if (this._zurueckHörer[i]()) return true; } catch (e) {}
      }
      return false;
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
    function hoerer(e) {
      if (e.alpha == null) return;
      // Richtung der Rückkamera aus der vollen Lage (R = Rz·Rx·Ry, Kamera =
      // Geräte-−Z). alpha allein wäre die Oberkante und zudem gegen den
      // Uhrzeigersinn gezählt – beim Hochkant-Halten unbrauchbar.
      var g = Math.PI / 180, a = e.alpha * g, b = (e.beta || 0) * g, c = (e.gamma || 0) * g;
      var ost = -(Math.cos(a) * Math.sin(c) + Math.sin(a) * Math.sin(b) * Math.cos(c));
      var nord = -(Math.sin(a) * Math.sin(c) - Math.cos(a) * Math.sin(b) * Math.cos(c));
      var oben = -(Math.cos(b) * Math.cos(c));
      var az = Math.hypot(ost, nord) > 0.05 ? Math.atan2(ost, nord) / g : 360 - e.alpha;
      self._empfangeOrient({
        azimut: (az + 360) % 360, neigung: e.beta, roll: e.gamma, q: null,
        kameraNeigung: Math.asin(Math.max(-1, Math.min(1, oben))) / g
      });
    }
    if (window.DeviceOrientationEvent) {
      window.addEventListener("deviceorientation", hoerer);
      erlaubnisHolen(function () { window.addEventListener("deviceorientation", hoerer); });
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

  // ---- Lage zum Messen im Browser -------------------------------------
  var webLageHörer = null;
  function webLage(self) {
    if (webLageHörer) return;
    webLageHörer = function (e) {
      if (e.alpha == null || e.beta == null) return;
      self._empfangeLage({ euler: [e.alpha, e.beta, e.gamma || 0], absolut: !!e.absolute });
    };
    window.addEventListener("deviceorientation", webLageHörer);
    erlaubnisHolen(function () { if (webLageHörer) window.addEventListener("deviceorientation", webLageHörer); });
  }
  function webLageStopp() {
    if (!webLageHörer) return;
    window.removeEventListener("deviceorientation", webLageHörer);
    webLageHörer = null;
  }

  /**
   * Lagesensor-Erlaubnis. iOS verlangt sie nach einer Nutzergeste; neuere
   * Chromium-Versionen kennen `requestPermission` ebenfalls, antworten aber oft
   * mit „prompt" und liefern trotzdem Ereignisse. Deshalb wird der Hörer immer
   * angemeldet – die Erlaubnis ist nur ein Zusatz, nie die Bedingung.
   */
  function erlaubnisHolen(beiErlaubnis) {
    var DOE = window.DeviceOrientationEvent;
    if (!DOE || typeof DOE.requestPermission !== "function") return;
    try {
      DOE.requestPermission().then(function (s) { if (s === "granted") beiErlaubnis(); }).catch(function () {});
    } catch (e) {}
  }

  function herunterladen(name, mime, text) {
    try {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: mime }));
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      return true;
    } catch (e) { return false; }
  }

  // Im Browser den Steckbrief aus enumerateDevices nachbilden (Kameraliste).
  if (!A && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    navigator.mediaDevices.enumerateDevices().then(function (list) {
      var kams = list.filter(function (d) { return d.kind === "videoinput"; })
        .map(function (d, i) { return { id: d.deviceId, richtung: /front/i.test(d.label) ? "vorne" : "hinten", etikett: d.label || ("Kamera " + (i + 1)) }; });
      // Kurzer Gerätename statt des kompletten User-Agents (sprengt sonst die Zeile):
      // die letzte Angabe der ersten Klammer, also z. B. „Pixel 5“.
      var m = navigator.userAgent.match(/\(([^)]+)\)/);
      var teile = m ? m[1].split(";").map(function (s) { return s.trim(); }) : [];
      N._info = { hersteller: "Browser", modell: teile[teile.length - 1] || "Web", kameras: kams, sensoren: [] };
    }).catch(function () {});
  }

  window.__native = N;
  if (A) N.starte();   // in der App sofort; im Browser erst bei Bedarf (Geste)
})();
