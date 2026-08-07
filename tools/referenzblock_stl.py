#!/usr/bin/env python3
"""
Bauteile des RAUMWERK-Referenzblocks als STL – für einen 3D-Drucker mit
250 × 250 × 250 mm Bauraum.

Ein Würfel von 250 mm Kantenlänge passt nicht am Stück auf einen 250er
Drucker (kein Spielraum, absurde Druckzeit, Verzug). Deshalb ein
**Rahmen aus Ecken und Streben mit eingelegten Tafeln**:

    8 × Ecke     20 × 20 × 20 mm   (drei Zapfen)
   12 × Strebe   20 × 20 × 210 mm  (zwei Zapflöcher)
    6 × Tafel   210 × 210 ×  3 mm  (Vertiefung für den Papiermarker)

    20 + 210 + 20 = 250 mm Außenkante.

Jedes Teil hat rundum >= 20 mm Abstand zum Bauraumrand – genug für Brim und
für Betten, deren Rand nicht ganz eben ist.

Warum der Marker auf Papier bleibt und nicht mitgedruckt wird: die Erkennung
lebt von hartem Schwarz-Weiß-Kontrast und sauberen Kanten. Ein Laserdruck auf
mattem Papier ist darin jedem Zweifarbendruck überlegen, kostet fast nichts
und lässt sich bei Verschmutzung in einer Minute ersetzen.

Aufruf:  python3 tools/referenzblock_stl.py [Zielverzeichnis]
"""

import sys
import pathlib
import numpy as np
import trimesh

# ------------------------------------------------------------ Maße (mm)
KANTE = 250.0          # Außenkante des fertigen Würfels
PROFIL = 20.0          # Kantenlänge des quadratischen Rahmenprofils
STREBE_L = KANTE - 2 * PROFIL      # 210,0
TAFEL = STREBE_L                   # 210,0 – Tafel füllt die Rahmenöffnung
TAFEL_D = 3.0          # Tafeldicke – im Rahmen ringsum gehalten, das reicht
MARKERFELD = 190.0     # weißes Druckfeld des A4-Bogens
VERTIEFUNG = 0.4       # Papier liegt bündig und ist am Rand geschützt

ZAPFEN = 10.0          # Zapfenlänge
ZAPFEN_Q = 10.0        # Zapfenquerschnitt
SPIEL = 0.2            # Passung Zapfen ↔ Loch (je Seite)

BAURAUM = 250.0


def box(sx, sy, sz, mitte=(0, 0, 0)):
    m = trimesh.creation.box(extents=(sx, sy, sz))
    m.apply_translation(mitte)
    return m


def ecke():
    """Würfelecke mit drei Zapfen – je einer in +X, +Y, +Z."""
    teile = [box(PROFIL, PROFIL, PROFIL, (PROFIL / 2, PROFIL / 2, PROFIL / 2))]
    z, h = ZAPFEN_Q, ZAPFEN
    teile.append(box(h, z, z, (PROFIL + h / 2, PROFIL / 2, PROFIL / 2)))
    teile.append(box(z, h, z, (PROFIL / 2, PROFIL + h / 2, PROFIL / 2)))
    teile.append(box(z, z, h, (PROFIL / 2, PROFIL / 2, PROFIL + h / 2)))
    return trimesh.boolean.union(teile)


def strebe():
    """Rahmenstrebe mit Zapfloch an beiden Enden."""
    koerper = box(STREBE_L, PROFIL, PROFIL, (STREBE_L / 2, PROFIL / 2, PROFIL / 2))
    lo = ZAPFEN_Q + 2 * SPIEL
    tiefe = ZAPFEN + SPIEL
    a = box(tiefe, lo, lo, (tiefe / 2 - 0.01, PROFIL / 2, PROFIL / 2))
    b = box(tiefe, lo, lo, (STREBE_L - tiefe / 2 + 0.01, PROFIL / 2, PROFIL / 2))
    return trimesh.boolean.difference([koerper, a, b])


def tafel():
    """Tafel mit flacher Vertiefung für den 190-mm-Markerbogen."""
    koerper = box(TAFEL, TAFEL, TAFEL_D, (TAFEL / 2, TAFEL / 2, TAFEL_D / 2))
    tasche = box(MARKERFELD, MARKERFELD, VERTIEFUNG * 2,
                 (TAFEL / 2, TAFEL / 2, TAFEL_D))
    return trimesh.boolean.difference([koerper, tasche])


# Materialanteil je Bauteil: dünne Tafeln sind fast durchgehend massiv
# (Deck-/Bodenschichten), dicke Profile bestehen überwiegend aus Füllung.
TEILE = [
    ("ecke", ecke, 8, "Ecke – 3 Zapfen", 0.45),
    ("strebe", strebe, 12, "Strebe – 2 Zapflöcher", 0.40),
    ("tafel", tafel, 6, "Tafel – Markervertiefung", 0.70),
]


def main() -> None:
    ziel = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "docs/referenzblock/stl")
    ziel.mkdir(parents=True, exist_ok=True)

    print(f"{'Teil':10s} {'Anz':>4s} {'Maße (mm)':>26s} {'Volumen cm³':>12s}  dicht  passt")
    gesamt_vol = 0.0
    alles_gut = True
    for name, fn, anzahl, _, anteil in TEILE:
        m = fn()
        m.export(ziel / f"{name}.stl")
        e = m.extents
        passt = all(v <= BAURAUM - 20 for v in e)     # 10 mm Rand je Seite
        dicht = m.is_watertight
        alles_gut &= passt and dicht
        vol = m.volume / 1000.0
        gesamt_vol += vol * anzahl * anteil
        print(f"{name:10s} {anzahl:4d} {e[0]:7.1f}×{e[1]:6.1f}×{e[2]:6.1f} "
              f"{vol:12.1f}  {'ja' if dicht else 'NEIN':>5s}  {'ja' if passt else 'NEIN'}")

    # PETG ≈ 1,27 g/cm³. gesamt_vol ist bereits das *effektive* Volumen.
    masse = gesamt_vol * 1.27
    print(f"\nEffektives Materialvolumen aller 26 Teile: {gesamt_vol:.0f} cm³")
    print(f"Filament grob (PETG, ~25 % Füllung): {masse:.0f} g  ≈ {masse/1000*22:.2f} € bei 22 €/kg")
    print(f"Außenkante montiert: {PROFIL + STREBE_L + PROFIL:.1f} mm")
    print("Alle Teile wasserdicht und im Bauraum:", alles_gut)


if __name__ == "__main__":
    main()
