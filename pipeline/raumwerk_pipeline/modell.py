"""
Die Rekonstruktion lesen – woher die **Modellabstände** für den Maß-Solver kommen.

Der Maß-Solver braucht Paare (Modellabstand, echte Länge). Die echte Länge
kommt vom Laser, vom Bandmaß oder als Kamerahöhe über dem Boden; der
Modellabstand muss **aus der Rekonstruktion gelesen** werden – nie erfunden.
Diese Datei liest das spärliche COLMAP-Modell (`sparse/0`, Text- oder
Binärformat) und löst Modellpunkte auf.

Ein Modellpunkt (`modell_a` / `modell_b` eines Lasermaßes oder einer bekannten
Länge, Einträge in `boden`) ist immer ein **Bildpunkt**:

    {"bild": "IMG_001.jpg", "px": [u, v]}
                                     aufgelöst über den nächsten rekonstruierten
                                     Merkmalspunkt (≤ radius_px, Vorgabe 10 px)
                                     in diesem Bild

Punkt-IDs (`1234`, `{"punkt3d": 1234}`) und Modellkoordinaten (`[x, y, z]`)
werden abgelehnt: Sie gelten nur für die Rekonstruktion, aus der sie stammen.
Jeder Lauf (auch /start) rechnet COLMAP von vorn – neue IDs, neuer Maßstab, neue
Lage. Eine alte ID gibt es meist trotzdem (fortlaufend nummeriert), nur ist es
ein anderer Punkt: Der Maßstab wäre still falsch. Ein Bildpunkt dagegen hängt
nur am Foto.

Kamerahöhe über dem Boden (bekannte Länge der Art „kamerahoehe"):

    {"art": "kamerahoehe", "laenge": 1.45,
     "boden": [<Bildpunkt>, <Bildpunkt>, <Bildpunkt>, …],   # ≥ 3, auf dem Boden
     "bild": "IMG_001.jpg"}                                 # optional

Der Modellabstand ist dann der Abstand des Kamerazentrums zur Bodenebene (mit
„bild" für genau dieses Bild, sonst gemittelt über alle registrierten Bilder –
passend, wenn das Handy auf gleichbleibender Höhe gehalten wurde).

Reine Standardbibliothek; das Binärformat entspricht COLMAPs
`read_write_model.py`.
"""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass, field
from pathlib import Path

Vektor = tuple[float, float, float]


class ModellFehler(ValueError):
    """Ein Modellpunkt oder -abstand lässt sich nicht aus der Rekonstruktion lesen."""


@dataclass
class Bild:
    name: str
    zentrum: Vektor                                   # Kamerazentrum im Modell
    beobachtungen: list = field(default_factory=list)  # [(u, v, punkt3d_id)], id ≥ 0


@dataclass
class SparseModell:
    punkte: dict = field(default_factory=dict)   # id → (x, y, z)
    bilder: dict = field(default_factory=dict)   # name → Bild

    def bild(self, name: str) -> Bild | None:
        if name in self.bilder:
            return self.bilder[name]
        # Nachsichtig: nur der Dateiname zählt (COLMAP speichert relative Pfade).
        kurz = Path(name).name
        for n, b in self.bilder.items():
            if Path(n).name == kurz:
                return b
        return None


# --------------------------------------------------------------- Laden

def finden(sparse_dir: Path) -> Path | None:
    """Das Modellverzeichnis: `sparse/0` (Mapper-Ausgabe) oder `sparse` selbst."""
    for kandidat in (sparse_dir / "0", sparse_dir):
        if any((kandidat / f).exists() for f in ("points3D.txt", "points3D.bin")):
            return kandidat
    return None


def laden(modell_dir: Path) -> SparseModell:
    """Liest points3D und images (Text bevorzugt, sonst binär)."""
    m = SparseModell()
    if (modell_dir / "points3D.txt").exists():
        m.punkte = _punkte_txt(modell_dir / "points3D.txt")
    elif (modell_dir / "points3D.bin").exists():
        m.punkte = _punkte_bin(modell_dir / "points3D.bin")
    else:
        raise ModellFehler(f"Kein spärliches Modell in {modell_dir} (points3D fehlt).")
    if (modell_dir / "images.txt").exists():
        m.bilder = _bilder_txt(modell_dir / "images.txt")
    elif (modell_dir / "images.bin").exists():
        m.bilder = _bilder_bin(modell_dir / "images.bin")
    return m


def _punkte_txt(pfad: Path) -> dict:
    punkte = {}
    for zeile in pfad.read_text(encoding="utf-8", errors="replace").splitlines():
        zeile = zeile.strip()
        if not zeile or zeile.startswith("#"):
            continue
        t = zeile.split()
        punkte[int(t[0])] = (float(t[1]), float(t[2]), float(t[3]))
    return punkte


def _bilder_txt(pfad: Path) -> dict:
    """images.txt: je Bild eine Kopfzeile und eine (evtl. leere) Zeile Merkmale."""
    bilder = {}
    zeilen = pfad.read_text(encoding="utf-8", errors="replace").splitlines()
    i = 0
    while i < len(zeilen):
        zeile = zeilen[i].strip()
        i += 1
        if not zeile or zeile.startswith("#"):
            continue
        t = zeile.split()
        q = tuple(float(v) for v in t[1:5])
        tv = tuple(float(v) for v in t[5:8])
        name = " ".join(t[9:])
        merkmale = zeilen[i].split() if i < len(zeilen) else []
        i += 1
        beob = []
        for k in range(0, len(merkmale) - 2, 3):
            pid = int(merkmale[k + 2])
            if pid >= 0:
                beob.append((float(merkmale[k]), float(merkmale[k + 1]), pid))
        bilder[name] = Bild(name=name, zentrum=kamerazentrum(q, tv), beobachtungen=beob)
    return bilder


def _lesen(datei, fmt: str):
    groesse = struct.calcsize(fmt)
    roh = datei.read(groesse)
    if len(roh) != groesse:
        raise ModellFehler("Binärmodell ist abgeschnitten.")
    return struct.unpack(fmt, roh)


def _punkte_bin(pfad: Path) -> dict:
    punkte = {}
    with pfad.open("rb") as f:
        (anzahl,) = _lesen(f, "<Q")
        for _ in range(anzahl):
            pid, x, y, z, _r, _g, _b, _fehler = _lesen(f, "<QdddBBBd")
            (spur,) = _lesen(f, "<Q")
            f.seek(8 * spur, 1)              # (image_id, point2D_idx) je int32
            punkte[pid] = (x, y, z)
    return punkte


def _bilder_bin(pfad: Path) -> dict:
    bilder = {}
    with pfad.open("rb") as f:
        (anzahl,) = _lesen(f, "<Q")
        for _ in range(anzahl):
            werte = _lesen(f, "<idddddddi")
            q, tv = werte[1:5], werte[5:8]
            name = b""
            while True:
                c = f.read(1)
                if c in (b"\x00", b""):
                    break
                name += c
            (n2d,) = _lesen(f, "<Q")
            beob = []
            roh = f.read(24 * n2d)
            if len(roh) != 24 * n2d:
                raise ModellFehler("Binärmodell ist abgeschnitten.")
            for u, v, pid in struct.iter_unpack("<ddq", roh):
                if pid >= 0:
                    beob.append((u, v, pid))
            n = name.decode("utf-8", errors="replace")
            bilder[n] = Bild(name=n, zentrum=kamerazentrum(q, tv), beobachtungen=beob)
    return bilder


# --------------------------------------------------------------- Geometrie

def kamerazentrum(q, t) -> Vektor:
    """COLMAP speichert Welt→Kamera (R, t); das Zentrum ist C = −Rᵀ·t."""
    w, x, y, z = q
    r = (
        (1 - 2 * y * y - 2 * z * z, 2 * x * y - 2 * w * z, 2 * x * z + 2 * w * y),
        (2 * x * y + 2 * w * z, 1 - 2 * x * x - 2 * z * z, 2 * y * z - 2 * w * x),
        (2 * x * z - 2 * w * y, 2 * y * z + 2 * w * x, 1 - 2 * x * x - 2 * y * y),
    )
    return tuple(-(r[0][k] * t[0] + r[1][k] * t[1] + r[2][k] * t[2]) for k in range(3))


def abstand(a: Vektor, b: Vektor) -> float:
    return math.sqrt(sum((a[k] - b[k]) ** 2 for k in range(3)))


def ebene(punkte: list[Vektor]) -> tuple[Vektor, Vektor]:
    """
    Ausgleichsebene durch ≥ 3 Punkte: (Schwerpunkt, Einheitsnormale). Die
    Normale ist der Eigenvektor zum kleinsten Eigenwert der Kovarianz
    (Jacobi-Verfahren, 3×3 – keine numpy-Abhängigkeit).
    """
    if len(punkte) < 3:
        raise ModellFehler("Für die Bodenebene sind mindestens drei Bodenpunkte nötig.")
    n = len(punkte)
    c = tuple(sum(p[k] for p in punkte) / n for k in range(3))
    a = [[sum((p[i] - c[i]) * (p[j] - c[j]) for p in punkte) for j in range(3)] for i in range(3)]
    werte, vektoren = _jacobi(a)
    reihenfolge = sorted(range(3), key=lambda k: werte[k])
    if werte[reihenfolge[1]] <= 1e-12 * max(1.0, werte[reihenfolge[2]]):
        # Zweitgrößte Streuung ≈ 0: alle Punkte liegen auf einer Linie.
        raise ModellFehler("Bodenpunkte liegen auf einer Linie – drei nicht kollineare Punkte nötig.")
    k = reihenfolge[0]
    normale = (vektoren[0][k], vektoren[1][k], vektoren[2][k])
    laenge = math.sqrt(sum(v * v for v in normale)) or 1.0
    return c, tuple(v / laenge for v in normale)


def _jacobi(a: list[list[float]], runden: int = 60):
    """Eigenwerte/-vektoren einer symmetrischen 3×3-Matrix (Spalten = Vektoren)."""
    a = [zeile[:] for zeile in a]
    v = [[1.0 if i == j else 0.0 for j in range(3)] for i in range(3)]
    for _ in range(runden):
        p, q = max(((0, 1), (0, 2), (1, 2)), key=lambda ij: abs(a[ij[0]][ij[1]]))
        if abs(a[p][q]) < 1e-15:
            break
        theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        t = (1.0 if theta >= 0 else -1.0) / (abs(theta) + math.sqrt(theta * theta + 1))
        cos = 1 / math.sqrt(t * t + 1)
        sin = t * cos
        for k in range(3):
            akp, akq = a[k][p], a[k][q]
            a[k][p], a[k][q] = cos * akp - sin * akq, sin * akp + cos * akq
        for k in range(3):
            apk, aqk = a[p][k], a[q][k]
            a[p][k], a[q][k] = cos * apk - sin * aqk, sin * apk + cos * aqk
        for k in range(3):
            vkp, vkq = v[k][p], v[k][q]
            v[k][p], v[k][q] = cos * vkp - sin * vkq, sin * vkp + cos * vkq
    return [a[i][i] for i in range(3)], v


# ------------------------------------------------------------ Auflösung

def hat_modellbezug(eintrag: dict) -> bool:
    """Trägt ein Lasermaß / eine bekannte Länge überhaupt Modellpunkte?"""
    if not isinstance(eintrag, dict):
        return False
    if eintrag.get("modell_a") is not None and eintrag.get("modell_b") is not None:
        return True
    return eintrag.get("art") == "kamerahoehe" and bool(eintrag.get("boden"))


NUR_BILDPUNKTE = ("Punkt-IDs und Modellkoordinaten gelten nur für den Lauf, der sie erzeugt "
                  "hat – jeder Lauf rekonstruiert neu (neue IDs, neuer Maßstab, neue Lage). "
                  "Bildpunkt {bild, px} angeben.")


def punkt(ref, modell: SparseModell | None) -> Vektor:
    """Einen Modellpunkt (Bildpunkt) in der aktuellen Rekonstruktion auflösen."""
    pruefen(ref)
    return _bildpunkt(ref, modell)


def pruefen(ref) -> None:
    """
    Nur die Form prüfen (ohne Modell) – damit ein Auftrag mit Punkt-IDs oder
    Modellkoordinaten scheitert, BEVOR COLMAP eine Stunde rechnet.
    """
    if isinstance(ref, dict) and "bild" in ref and "px" in ref:
        return
    if isinstance(ref, (list, tuple)) and len(ref) == 3 and all(_ist_zahl(v) for v in ref):
        raise ModellFehler(f"Modellkoordinaten {list(ref)} abgelehnt: {NUR_BILDPUNKTE}")
    if _ist_ganzzahl(ref) or (isinstance(ref, dict) and "punkt3d" in ref):
        pid = ref.get("punkt3d") if isinstance(ref, dict) else ref
        raise ModellFehler(f"Punkt-ID {pid} abgelehnt: {NUR_BILDPUNKTE}")
    raise ModellFehler(f"Modellpunkt nicht lesbar: {ref!r} (erwartet Bildpunkt {{bild, px}}).")


def bezug_pruefen(eintrag: dict) -> None:
    """Alle Modellpunkte eines Eintrags (modell_a/modell_b bzw. boden) der Form nach prüfen."""
    if eintrag.get("art") == "kamerahoehe" and eintrag.get("boden"):
        refs = eintrag["boden"]
        if not isinstance(refs, list):
            raise ModellFehler("Bodenpunkte: Liste von Bildpunkten erwartet.")
    else:
        refs = [eintrag.get("modell_a"), eintrag.get("modell_b")]
    for ref in refs:
        pruefen(ref)


def _bildpunkt(ref: dict, modell: SparseModell | None) -> Vektor:
    if modell is None:
        raise ModellFehler("Bildpunkt: kein spärliches Modell vorhanden.")
    name = str(ref["bild"])
    px = ref["px"]
    if not (isinstance(px, (list, tuple)) and len(px) == 2 and all(_ist_zahl(v) for v in px)):
        raise ModellFehler(f"Bildpunkt in {name}: px muss [u, v] sein.")
    bild = modell.bild(name)
    if bild is None:
        raise ModellFehler(f"Bild {name} wurde nicht rekonstruiert (nicht im Modell registriert).")
    radius = float(ref.get("radius_px", 10.0))
    u, v = float(px[0]), float(px[1])
    bester, bester_d = None, radius
    for bu, bv, pid in bild.beobachtungen:
        d = math.hypot(bu - u, bv - v)
        if d <= bester_d and pid in modell.punkte:
            bester, bester_d = pid, d
    if bester is None:
        raise ModellFehler(
            f"Bildpunkt ({u:.0f}, {v:.0f}) in {name}: kein rekonstruierter 3D-Punkt "
            f"im Umkreis von {radius:.0f} px.")
    return modell.punkte[bester]


def modell_abstand(eintrag: dict, modell: SparseModell | None) -> float:
    """
    Den Modellabstand eines Eintrags aus der Rekonstruktion lesen. Wirft
    `ModellFehler` mit Klartext, wenn das nicht geht – nie eine Schätzung.
    """
    if eintrag.get("art") == "kamerahoehe" and eintrag.get("boden"):
        return _kamerahoehe(eintrag, modell)
    if eintrag.get("modell_a") is None or eintrag.get("modell_b") is None:
        raise ModellFehler("Keine Modellpunkte (modell_a/modell_b) angegeben.")
    a = punkt(eintrag["modell_a"], modell)
    b = punkt(eintrag["modell_b"], modell)
    d = abstand(a, b)
    if d <= 1e-12:
        raise ModellFehler("modell_a und modell_b sind derselbe Punkt.")
    return d


def _kamerahoehe(eintrag: dict, modell: SparseModell | None) -> float:
    boden = [punkt(r, modell) for r in eintrag["boden"]]
    c, n = ebene(boden)
    if eintrag.get("bild"):
        if modell is None or modell.bild(str(eintrag["bild"])) is None:
            raise ModellFehler(f"Bild {eintrag['bild']} wurde nicht rekonstruiert.")
        zentren = [modell.bild(str(eintrag["bild"])).zentrum]
    else:
        if modell is None or not modell.bilder:
            raise ModellFehler("Kamerahöhe: keine registrierten Bilder im Modell.")
        zentren = [b.zentrum for b in modell.bilder.values()]
    hoehen = [abs(sum((z[k] - c[k]) * n[k] for k in range(3))) for z in zentren]
    h = sum(hoehen) / len(hoehen)
    if h <= 1e-12:
        raise ModellFehler("Kamerazentrum liegt in der Bodenebene – Bodenpunkte prüfen.")
    return h


def _ist_zahl(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _ist_ganzzahl(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)
