"""
Nachgebaute Rekonstruktion für Tests: ein Raum 4,20 × 3,00 × 2,50 m, als
COLMAP-Modell in willkürlichen Einheiten (wahrer Maßstab S_WAHR, gedreht und
verschoben) – so, wie COLMAP es liefern würde. Dazu ein Ersatz für
`tools.ausfuehren`, der statt COLMAP/OpenMVS genau diese Dateien schreibt.
"""

from __future__ import annotations

import math
import struct
from pathlib import Path

from raumwerk_pipeline import tools

S_WAHR = 0.25          # Meter je Modelleinheit – der Solver muss genau das finden

# Raumecken in Metern (Boden z = 0, Decke z = 2,5).
ECKEN_M = {
    1: (0.0, 0.0, 0.0), 2: (4.2, 0.0, 0.0), 3: (4.2, 3.0, 0.0), 4: (0.0, 3.0, 0.0),
    5: (0.0, 0.0, 2.5), 6: (4.2, 0.0, 2.5), 7: (4.2, 3.0, 2.5), 8: (0.0, 3.0, 2.5),
}
# Drei Fotos, Handy auf 1,45 m gehalten.
KAMERAS_M = {
    "IMG_001.jpg": (1.0, 1.0, 1.45),
    "IMG_002.jpg": (2.0, 1.5, 1.45),
    "IMG_003.jpg": (3.0, 2.0, 1.45),
}
# Kameradrehungen (Quaternion w, x, y, z) – eine davon nicht trivial.
_Q = {
    "IMG_001.jpg": (1.0, 0.0, 0.0, 0.0),
    "IMG_002.jpg": (math.cos(math.pi / 4), 0.0, 0.0, math.sin(math.pi / 4)),
    "IMG_003.jpg": (math.cos(0.3), math.sin(0.3), 0.0, 0.0),
}
# Merkmale in IMG_001: Pixel → Punkt-ID (−1 = nicht rekonstruiert).
BEOBACHTUNGEN = {"IMG_001.jpg": [(100.0, 200.0, 1), (500.0, 210.0, 2),
                                 (520.0, 600.0, 3), (90.0, 610.0, -1)]}


def bildpunkt(pid: int, bild: str = "IMG_001.jpg") -> dict:
    """Ecke `pid` als Bildpunkt {bild, px} – die einzige Form, in der ein Auftrag
    Modellpunkte angibt (Punkt-IDs gelten nur für einen Lauf)."""
    u, v, _ = next(b for b in BEOBACHTUNGEN[bild] if b[2] == pid)
    return {"bild": bild, "px": [u + 2, v - 1]}       # angetippt: knapp daneben


def _rot(achse: str, winkel: float):
    c, s = math.cos(winkel), math.sin(winkel)
    if achse == "x":
        return ((1, 0, 0), (0, c, -s), (0, s, c))
    return ((c, -s, 0), (s, c, 0), (0, 0, 1))


def _mal(a, v):
    return tuple(sum(a[i][k] * v[k] for k in range(3)) for i in range(3))


def _matmal(a, b):
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)) for i in range(3))


_WELT = _matmal(_rot("z", 0.35), _rot("x", 0.5))   # beliebige Lage des Modells
_VERSATZ = (3.0, -7.0, 11.0)


def ins_modell(p_m):
    """Meter → Modellkoordinaten (Maßstab 1/S_WAHR, gedreht, verschoben)."""
    r = _mal(_WELT, tuple(v / S_WAHR for v in p_m))
    return tuple(r[k] + _VERSATZ[k] for k in range(3))


def _r_aus_q(q):
    w, x, y, z = q
    return (
        (1 - 2 * y * y - 2 * z * z, 2 * x * y - 2 * w * z, 2 * x * z + 2 * w * y),
        (2 * x * y + 2 * w * z, 1 - 2 * x * x - 2 * z * z, 2 * y * z - 2 * w * x),
        (2 * x * z - 2 * w * y, 2 * y * z + 2 * w * x, 1 - 2 * x * x - 2 * y * y),
    )


def _t_fuer(q, zentrum):
    """COLMAP speichert t = −R·C."""
    r = _r_aus_q(q)
    return tuple(-v for v in _mal(r, zentrum))


def punkte_modell():
    return {pid: ins_modell(p) for pid, p in ECKEN_M.items()}


def schreibe_modell_txt(d: Path) -> None:
    d.mkdir(parents=True, exist_ok=True)
    zeilen = ["# 3D point list", "#   POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[]"]
    for pid, (x, y, z) in punkte_modell().items():
        zeilen.append(f"{pid} {x!r} {y!r} {z!r} 200 200 200 0.5 1 0")
    (d / "points3D.txt").write_text("\n".join(zeilen) + "\n", encoding="utf-8")
    zeilen = ["# Image list with two lines of data per image:"]
    for i, (name, c_m) in enumerate(KAMERAS_M.items(), start=1):
        q = _Q[name]
        t = _t_fuer(q, ins_modell(c_m))
        zeilen.append(f"{i} {q[0]!r} {q[1]!r} {q[2]!r} {q[3]!r} {t[0]!r} {t[1]!r} {t[2]!r} 1 {name}")
        # Zweite Zeile: Merkmale – bei Bildern ohne Merkmale bewusst LEER.
        zeilen.append(" ".join(f"{u} {v} {pid}" for u, v, pid in BEOBACHTUNGEN.get(name, [])))
    (d / "images.txt").write_text("\n".join(zeilen) + "\n", encoding="utf-8")


def schreibe_modell_bin(d: Path) -> None:
    d.mkdir(parents=True, exist_ok=True)
    with (d / "points3D.bin").open("wb") as f:
        pts = punkte_modell()
        f.write(struct.pack("<Q", len(pts)))
        for pid, (x, y, z) in pts.items():
            f.write(struct.pack("<QdddBBBd", pid, x, y, z, 200, 200, 200, 0.5))
            f.write(struct.pack("<Q", 2))
            f.write(struct.pack("<iiii", 1, 0, 2, 0))
    with (d / "images.bin").open("wb") as f:
        f.write(struct.pack("<Q", len(KAMERAS_M)))
        for i, (name, c_m) in enumerate(KAMERAS_M.items(), start=1):
            q = _Q[name]
            t = _t_fuer(q, ins_modell(c_m))
            f.write(struct.pack("<idddddddi", i, *q, *t, 1))
            f.write(name.encode("utf-8") + b"\x00")
            beob = BEOBACHTUNGEN.get(name, [])
            f.write(struct.pack("<Q", len(beob)))
            for u, v, pid in beob:
                f.write(struct.pack("<ddq", u, v, pid))


def schreibe_binaer_ply(pfad: Path, punkte, mit_normalen: bool = True) -> None:
    """Wie OpenMVS: binär, x y z [nx ny nz] red green blue."""
    kopf = ["ply", "format binary_little_endian 1.0", "comment erzeugt von Test",
            f"element vertex {len(punkte)}",
            "property float x", "property float y", "property float z"]
    if mit_normalen:
        kopf += ["property float nx", "property float ny", "property float nz"]
    kopf += ["property uchar red", "property uchar green", "property uchar blue",
             "element face 0", "property list uchar int vertex_indices", "end_header"]
    with pfad.open("wb") as f:
        f.write(("\n".join(kopf) + "\n").encode("ascii"))
        for i, (x, y, z) in enumerate(punkte):
            f.write(struct.pack("<fff", x, y, z))
            if mit_normalen:
                f.write(struct.pack("<fff", 0.0, 0.0, 1.0))
            f.write(struct.pack("<BBB", i % 256, 100, 200))


class FalscheWerkzeuge:
    """Ersatz für tools.ausfuehren: schreibt, was COLMAP/OpenMVS schreiben würden."""

    def __init__(self, binaer: bool = False, mapper_ok: bool = True):
        self.binaer = binaer
        self.mapper_ok = mapper_ok
        self.aufrufe: list[list[str]] = []

    def __call__(self, kommando, cfg, cwd=None):
        self.aufrufe.append(list(kommando))
        jd = Path(cwd)
        if kommando[:2] == ["colmap", "mapper"] and self.mapper_ok:
            (schreibe_modell_bin if self.binaer else schreibe_modell_txt)(jd / "sparse" / "0")
        if kommando[0] == "DensifyPointCloud":
            pts = list(punkte_modell().values())
            schreibe_binaer_ply(jd / tools.DICHTE_PLY, pts * 3)
        return tools.Lauf(kommando=list(kommando), rueckgabe=0, ausgabe="ok")
