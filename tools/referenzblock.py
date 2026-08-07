#!/usr/bin/env python3
"""
Druckvorlagen für den RAUMWERK-Referenzblock (25 × 25 × 25 cm).

Erzeugt sechs A4-Seiten als **Vektor-SVG** – je eine Fläche des Würfels mit
einem AprilTag-Marker (Familie tag36h11). Vektor statt Pixelbild, damit die
Kanten beim Drucken beliebig scharf bleiben.

Warum tag36h11:
  · 587 Codes, Mindest-Hamming-Abstand 11 → praktisch keine Falscherkennung
  · bis zu 5 Bitfehler korrigierbar (teilweise Verdeckung, Schmutz, Schatten)
  · in OpenCV enthalten (cv2.aruco), also ohne ARCore nutzbar

Maße (Millimeter, absichtlich runde Zahlen zum Nachmessen):
  · Würfelkante            250,0 mm
  · Marker (schwarzes Feld) 160,0 mm  → 8 Module à 20,0 mm
  · Weißrand auf dem Blatt   15,0 mm
  · Ruhezone gesamt          45,0 mm  (= 2,25 Module, gefordert ist ≥ 1)

Aufruf:  python3 tools/referenzblock.py [Zielverzeichnis]
"""

import sys
import pathlib
import cv2
import cv2.aruco as aruco
import numpy as np

KANTE_MM = 250.0        # Würfelkante
MARKER_MM = 160.0       # schwarzes Markerquadrat
BLATT_RAND_MM = 15.0    # zusätzlicher Weißrand auf dem Druckblatt
A4_B, A4_H = 210.0, 297.0
KONTROLL_MM = 100.0     # Kontrollstrecke zum Prüfen des Druckmaßstabs

FLAECHEN = [
    (0, "OBEN"), (1, "VORN"), (2, "RECHTS"),
    (3, "HINTEN"), (4, "LINKS"), (5, "UNTEN"),
]

TINTE = "#2C2A28"
ZIEGEL = "#A8432A"
FUGE = "#6E5B4E"


def modulraster(marker_id: int) -> np.ndarray:
    """Bool-Raster (8×8) des Markers: True = schwarz."""
    d = aruco.getPredefinedDictionary(aruco.DICT_APRILTAG_36h11)
    n = d.markerSize + 2
    bild = aruco.generateImageMarker(d, marker_id, n)
    return bild < 127


def svg_flaeche(marker_id: int, name: str, nr: int) -> str:
    raster = modulraster(marker_id)
    n = raster.shape[0]
    modul = MARKER_MM / n
    feld = MARKER_MM + 2 * BLATT_RAND_MM          # weißes Druckfeld
    x0 = (A4_B - feld) / 2
    y0 = 42.0
    mx, my = x0 + BLATT_RAND_MM, y0 + BLATT_RAND_MM

    t = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{A4_B}mm" height="{A4_H}mm" '
         f'viewBox="0 0 {A4_B} {A4_H}">',
         '<rect width="100%" height="100%" fill="#fff"/>']

    # Kopfzeile
    t.append(f'<text x="{A4_B/2}" y="16" text-anchor="middle" font-family="Georgia,serif" '
             f'font-size="7" font-weight="700" fill="{TINTE}">RAUMWERK · REFERENZBLOCK 250 mm</text>')
    t.append(f'<text x="{A4_B/2}" y="24" text-anchor="middle" font-family="monospace" '
             f'font-size="4.2" letter-spacing="0.6" fill="{FUGE}">'
             f'FLÄCHE {nr} · {name} · TAG36H11 · ID {marker_id} · MARKERKANTE 160,0 mm</text>')

    # „OBEN"-Pfeil: gibt jeder Fläche eine eindeutige Ausrichtung
    py = y0 - 6
    t.append(f'<path d="M{A4_B/2},{py-5} l4,6 h-2.4 v5 h-3.2 v-5 h-2.4 z" fill="{ZIEGEL}"/>')
    t.append(f'<text x="{A4_B/2+9}" y="{py+4}" font-family="monospace" font-size="4" '
             f'font-weight="700" fill="{ZIEGEL}">OBEN</text>')

    # Weißes Druckfeld mit feinen Eckmarken (Schnitthilfe, außerhalb der Ruhezone)
    for ex, ey, dx, dy in [(x0, y0, 1, 1), (x0 + feld, y0, -1, 1),
                           (x0, y0 + feld, 1, -1), (x0 + feld, y0 + feld, -1, -1)]:
        t.append(f'<path d="M{ex},{ey + dy*6} V{ey} H{ex + dx*6}" fill="none" '
                 f'stroke="{FUGE}" stroke-width="0.25"/>')

    # Der Marker selbst – ein Rechteck je schwarzem Modul
    t.append(f'<g fill="{TINTE}" shape-rendering="crispEdges">')
    for r in range(n):
        for c in range(n):
            if raster[r, c]:
                t.append(f'<rect x="{mx + c*modul:.4f}" y="{my + r*modul:.4f}" '
                         f'width="{modul:.4f}" height="{modul:.4f}"/>')
    t.append('</g>')

    # Kontrollmaß – der wichtigste Teil gegen Druckskalierung
    ky = y0 + feld + 22
    kx = (A4_B - KONTROLL_MM) / 2
    t.append(f'<path d="M{kx},{ky} h{KONTROLL_MM} M{kx},{ky-3} v6 M{kx+KONTROLL_MM},{ky-3} v6" '
             f'fill="none" stroke="{TINTE}" stroke-width="0.5"/>')
    for i in range(1, 10):
        t.append(f'<path d="M{kx + i*10},{ky-1.6} v3.2" stroke="{TINTE}" stroke-width="0.3"/>')
    t.append(f'<text x="{A4_B/2}" y="{ky+11}" text-anchor="middle" font-family="monospace" '
             f'font-size="4.6" font-weight="700" fill="{TINTE}">KONTROLLMASS 100,0 mm</text>')
    t.append(f'<text x="{A4_B/2}" y="{ky+18}" text-anchor="middle" font-family="sans-serif" '
             f'font-size="3.8" fill="{FUGE}">'
             f'Ohne Skalierung drucken (100 %, „Seitenanpassung" AUS). Diese Strecke nachmessen.</text>')
    t.append(f'<text x="{A4_B/2}" y="{ky+24}" text-anchor="middle" font-family="sans-serif" '
             f'font-size="3.8" fill="{FUGE}">'
             f'Weicht sie ab: echte Markerkante messen und in der App unter „Würfelkante" eintragen.</text>')

    t.append('</svg>')
    return "\n".join(t)


def main() -> None:
    ziel = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "docs/referenzblock")
    ziel.mkdir(parents=True, exist_ok=True)

    namen = []
    for nr, (mid, name) in enumerate(FLAECHEN, start=1):
        datei = ziel / f"flaeche{nr}_{name.lower()}_id{mid}.svg"
        datei.write_text(svg_flaeche(mid, name, nr), encoding="utf-8")
        namen.append(datei.name)
        print(f"  {datei}")

    seiten = "\n".join(
        f'  <img class="seite" src="{n}" alt="">' for n in namen)
    (ziel / "druck.html").write_text(f"""<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<title>RAUMWERK · Referenzblock – Druckbogen</title>
<style>
  @page {{ size: A4 portrait; margin: 0; }}
  body {{ margin: 0; background: #e7e0d6; font-family: system-ui, sans-serif; }}
  .hinweis {{ padding: 18px 22px; background: #fff; border-bottom: 2px solid #D9C2A3; }}
  .hinweis h1 {{ font: 700 20px Georgia, serif; margin: 0 0 6px; color: #2C2A28; }}
  .hinweis p {{ margin: 4px 0; font-size: 14px; color: #6E5B4E; }}
  .seite {{ display: block; width: 210mm; height: 297mm; page-break-after: always; }}
  @media print {{ .hinweis {{ display: none; }} body {{ background: #fff; }} }}
</style></head><body>
<div class="hinweis">
  <h1>Referenzblock 250 mm – 6 Druckseiten</h1>
  <p><b>Wichtig:</b> im Druckdialog Skalierung auf <b>100 %</b> stellen
     („An Seite anpassen" ausschalten), Rand „keine/minimal".</p>
  <p>Nach dem Druck das Kontrollmaß mit dem Lineal prüfen und die
     <b>tatsächliche</b> Markerkante in der App eintragen.</p>
  <p>Papier: <b>matt</b> (kein Glanz, keine Glanzlaminierung) – Reflexe verhindern die Erkennung.</p>
</div>
{seiten}
</body></html>""", encoding="utf-8")
    print(f"  {ziel/'druck.html'}")


if __name__ == "__main__":
    main()
