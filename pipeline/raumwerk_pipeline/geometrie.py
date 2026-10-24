"""
Polygonzug – Spiegel von `zug()`, `normieren()`, `umrissSchreiben()`,
`flaechePunkte()`, `pruefen()` und `schneidetSichSelbst()` aus
`web/geometrie.js`.

Warum doppelt? Damit die Pipeline aus einem Bandmaß-Zug (bekannte Wandlängen
plus Abbiegungen) **denselben** Umriss vorschlägt, den der Aufmaß-Assistent im
Browser aus denselben Zahlen rechnen würde. Der Vorschlag landet als `raum`-Block
in `result.json` – im Schema des Assistenten (`methode`, `umriss`, `breiteM`,
`tiefeM`, `hoeheM`, `waende[]`), damit die App ihn ohne Umbau übernehmen kann.

**Regel bei Änderungen:** `web/geometrie.js` ist für diese Funktionen die
Vorlage. Wer dort eine Formel ändert, ändert sie hier mit; der Paritätstest
(`tests/test_geometrie.py`) vergleicht beide, sobald `node` vorhanden ist.

Koordinaten wie im Browser: Ursprung links oben, x nach rechts, y nach hinten,
Meter. Ein Umriss ist eine Liste von [x, y]-Paaren.
"""

from __future__ import annotations

import json
import math


def _js_runden(wert: float, stellen: int = 2) -> float:
    """`Math.round(v · 10^n) / 10^n` – JS rundet halbe Werte nach oben, Python
    (Banker's Rounding) nicht. Ohne diese Hilfe wichen Zentimeter ab."""
    f = 10 ** stellen
    return math.floor(wert * f + 0.5) / f


def zug(waende: list[dict]) -> dict:
    """
    Wandliste → Umriss. Start (0,0), Blick nach rechts; nach jeder Wand um ihren
    Winkel drehen (positiv = rechts). Jede Wand: ``{"laenge": m, "drehung": °}``.

    ``restluecke`` ist die Qualitätsaussage des Aufmaßes: Schließt sich der Zug
    nicht (≥ 2 cm), steckt ein Messfehler drin – dann bleibt der letzte Punkt
    stehen und die Schlusswand ergibt sich rechnerisch.
    """
    x = y = richtung = 0.0
    roh = [[0.0, 0.0]]
    for w in waende:
        bogen = richtung * math.pi / 180.0
        x += float(w["laenge"]) * math.cos(bogen)
        y += float(w["laenge"]) * math.sin(bogen)
        roh.append([x, y])
        richtung += float(w["drehung"])
    letzte = roh[-1]
    restluecke = math.hypot(letzte[0] - roh[0][0], letzte[1] - roh[0][1])
    geschlossen = restluecke < 0.02
    return {
        "punkte": normieren(roh[:-1] if geschlossen else roh),
        "restluecke": restluecke,
        "geschlossen": geschlossen,
        "schlusswandErgaenzt": not geschlossen,
    }


def normieren(punkte: list[list[float]]) -> list[list[float]]:
    """Auf den Nullpunkt schieben und auf Zentimeter runden."""
    if not punkte:
        return punkte
    min_x = min(p[0] for p in punkte)
    min_y = min(p[1] for p in punkte)
    return [[_js_runden(p[0] - min_x), _js_runden(p[1] - min_y)] for p in punkte]


def _js_zahl(v: float):
    """Zahl so ausgeben, wie `JSON.stringify` es täte: 3 statt 3.0, nie -0."""
    v = v + 0.0                      # -0.0 → 0.0
    return int(v) if v == int(v) else v


def umriss_schreiben(punkte: list[list[float]]) -> str:
    """Spiegel von `umrissSchreiben`: kompaktes JSON, auf cm gerundet."""
    return json.dumps(
        [[_js_zahl(_js_runden(p[0])), _js_zahl(_js_runden(p[1]))] for p in punkte],
        separators=(",", ":"),
    )


def flaeche_punkte(p: list[list[float]]) -> float:
    """Gaußsche Trapezformel (Spiegel von `flaechePunkte`)."""
    summe = 0.0
    for i in range(len(p)):
        q = p[(i + 1) % len(p)]
        summe += p[i][0] * q[1] - q[0] * p[i][1]
    return abs(summe) / 2.0


def schneidet_sich_selbst(p: list[list[float]]) -> bool:
    """Spiegel von `schneidetSichSelbst`."""
    n = len(p)

    def rich(a, b, c):
        v = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1])
        return 0 if abs(v) < 1e-9 else (1 if v > 0 else 2)

    for i in range(n):
        for j in range(i + 1, n):
            if j == i or (j + 1) % n == i or (i + 1) % n == j:
                continue
            a, b, c, d = p[i], p[(i + 1) % n], p[j], p[(j + 1) % n]
            if rich(a, b, c) != rich(a, b, d) and rich(c, d, a) != rich(c, d, b):
                return True
    return False


def pruefen(punkte: list[list[float]]) -> list[str]:
    """Hinweise statt Ausnahmen – der Mensch entscheidet, was ein Fehler ist."""
    if len(punkte) < 3:
        return ["Weniger als drei Ecken – daraus wird kein Raum."]
    hinweise = []
    for i, a in enumerate(punkte):
        b = punkte[(i + 1) % len(punkte)]
        laenge = math.hypot(b[0] - a[0], b[1] - a[1])
        if laenge < 0.05:
            hinweise.append(
                f"Wand {i + 1} ist nur {math.floor(laenge * 100 + 0.5)} cm lang – Tippfehler?")
    if flaeche_punkte(punkte) < 0.5:
        hinweise.append("Fläche unter 0,5 m² – der Zug ist vermutlich in sich verdreht.")
    if schneidet_sich_selbst(punkte):
        hinweise.append("Die Wände kreuzen sich – meist ist eine Drehung falsch herum eingetragen.")
    return hinweise
