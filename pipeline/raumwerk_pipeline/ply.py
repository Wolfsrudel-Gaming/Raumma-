"""
PLY lesen und als **ASCII-PLY** für den Betrachter schreiben.

OpenMVS (`DensifyPointCloud`) schreibt seine dichte Wolke binär
(`szene_dense.ply`). Der Browser-Betrachter (`web/raumwerk/wolke3d.js`) liest
nur ASCII-PLY mit `x y z` und optional `red green blue`. Diese Datei wandelt
um – binär (little/big endian) oder ASCII rein, ASCII raus – und dünnt sehr
große Wolken gleichmäßig aus, damit der Browser sie noch tragen kann.

Reine Standardbibliothek. Gelesen wird das Element `vertex`; Elemente davor
(selten) werden übersprungen, Elemente danach (Flächen) ignoriert.
"""

from __future__ import annotations

import struct
from pathlib import Path

_TYPEN = {
    "char": "b", "int8": "b", "uchar": "B", "uint8": "B",
    "short": "h", "int16": "h", "ushort": "H", "uint16": "H",
    "int": "i", "int32": "i", "uint": "I", "uint32": "I",
    "float": "f", "float32": "f", "double": "d", "float64": "d",
}


class PlyFehler(ValueError):
    pass


def _kopf_lesen(f):
    if f.readline().strip() != b"ply":
        raise PlyFehler("Keine PLY-Datei (Kennung 'ply' fehlt).")
    fmt, elemente = None, []          # elemente: [name, anzahl, [(name, typ, listentypen)]]
    while True:
        zeile = f.readline()
        if not zeile:
            raise PlyFehler("PLY-Kopf ohne end_header.")
        t = zeile.decode("ascii", errors="replace").split()
        if not t or t[0] in ("comment", "obj_info"):
            continue
        if t[0] == "format":
            fmt = t[1]
        elif t[0] == "element":
            elemente.append([t[1], int(t[2]), []])
        elif t[0] == "property":
            if not elemente:
                raise PlyFehler("PLY-Eigenschaft vor dem ersten Element.")
            if t[1] == "list":
                elemente[-1][2].append((t[4], None, (t[2], t[3])))
            else:
                elemente[-1][2].append((t[2], t[1], None))
        elif t[0] == "end_header":
            break
    if fmt not in ("ascii", "binary_little_endian", "binary_big_endian"):
        raise PlyFehler(f"Unbekanntes PLY-Format: {fmt}")
    return fmt, elemente


def lesen(pfad: Path):
    """
    Liefert (positionen, farben|None) als Listen von Tupeln. Für große Wolken
    lieber `zu_ascii` nehmen – das streamt.
    """
    pos, farben = [], []
    for p, c in _vertices(pfad):
        pos.append(p)
        if c is not None:
            farben.append(c)
    return pos, (farben if farben and len(farben) == len(pos) else None)


def anzahl(pfad: Path) -> int:
    with Path(pfad).open("rb") as f:
        _, elemente = _kopf_lesen(f)
    for name, n, _ in elemente:
        if name == "vertex":
            return n
    return 0


def _vertices(pfad: Path):
    with Path(pfad).open("rb") as f:
        fmt, elemente = _kopf_lesen(f)
        ende = "<" if fmt == "binary_little_endian" else ">"
        for name, n, props in elemente:
            namen = [p[0] for p in props]
            if name == "vertex":
                for k in ("x", "y", "z"):
                    if k not in namen:
                        raise PlyFehler(f"PLY-Vertex ohne Eigenschaft {k}.")
                ix, iy, iz = (namen.index(k) for k in ("x", "y", "z"))
                farbe = all(k in namen for k in ("red", "green", "blue"))
                ir, ig, ib = (namen.index(k) if farbe else -1 for k in ("red", "green", "blue"))
                for werte in _zeilen(f, fmt, ende, n, props):
                    p = (float(werte[ix]), float(werte[iy]), float(werte[iz]))
                    c = (int(float(werte[ir])), int(float(werte[ig])), int(float(werte[ib]))) if farbe else None
                    yield p, c
                return
            for _ in _zeilen(f, fmt, ende, n, props):   # Element davor überspringen
                pass


def _zeilen(f, fmt: str, ende: str, n: int, props):
    if fmt == "ascii":
        gelesen = 0
        while gelesen < n:
            zeile = f.readline()
            if not zeile:
                raise PlyFehler("PLY endet vor der angekündigten Punktzahl.")
            t = zeile.split()
            if not t:
                continue
            werte, i = [], 0
            for _name, typ, liste in props:
                if liste:
                    k = int(t[i]); werte.append(t[i + 1:i + 1 + k]); i += 1 + k
                else:
                    werte.append(t[i]); i += 1
            gelesen += 1
            yield werte
        return
    if all(p[2] is None for p in props):
        # Schneller Weg: nur Skalare → feste Zeilenlänge, blockweise entpacken.
        satz = struct.Struct(ende + "".join(_typ(p[1]) for p in props))
        rest = n
        while rest > 0:
            stueck = min(rest, 65536)
            roh = f.read(satz.size * stueck)
            if len(roh) != satz.size * stueck:
                raise PlyFehler("PLY endet vor der angekündigten Punktzahl.")
            yield from satz.iter_unpack(roh)
            rest -= stueck
        return
    for _ in range(n):
        werte = []
        for _name, typ, liste in props:
            if liste:
                (k,) = _struct_lesen(f, ende + _typ(liste[0]))
                werte.append(_struct_lesen(f, ende + _typ(liste[1]) * k))
            else:
                (v,) = _struct_lesen(f, ende + _typ(typ))
                werte.append(v)
        yield werte


def _typ(name: str) -> str:
    if name not in _TYPEN:
        raise PlyFehler(f"Unbekannter PLY-Typ: {name}")
    return _TYPEN[name]


def _struct_lesen(f, fmt: str):
    groesse = struct.calcsize(fmt)
    roh = f.read(groesse)
    if len(roh) != groesse:
        raise PlyFehler("PLY endet vorzeitig.")
    return struct.unpack(fmt, roh)


def ascii_schreiben(ziel: Path, punkte, farben=None, kommentare=()) -> int:
    """Punkte (und optional Farben 0…255) als ASCII-PLY schreiben."""
    zeilen = _kopf(len(punkte), farben is not None, kommentare)
    for i, (x, y, z) in enumerate(punkte):
        if farben is not None:
            r, g, b = farben[i]
            zeilen.append(f"{_f(x)} {_f(y)} {_f(z)} {int(r)} {int(g)} {int(b)}")
        else:
            zeilen.append(f"{_f(x)} {_f(y)} {_f(z)}")
    Path(ziel).write_text("\n".join(zeilen) + "\n", encoding="ascii")
    return len(punkte)


def zu_ascii(quelle: Path, ziel: Path, max_punkte: int | None = None, kommentare=()) -> dict:
    """
    Beliebige PLY → ASCII-PLY für den Betrachter. Mit `max_punkte` wird
    gleichmäßig ausgedünnt (jeder k-te Punkt). Gibt Zahlen zur Wolke zurück.
    """
    gesamt = anzahl(quelle)
    schritt = 1
    if max_punkte and gesamt > max_punkte:
        schritt = -(-gesamt // max_punkte)          # aufrunden
    behalten = len(range(0, gesamt, schritt))
    with Path(quelle).open("rb") as f:
        _, elemente = _kopf_lesen(f)
    namen = next((p for e, _, p in elemente if e == "vertex"), [])
    farbe = all(k in [p[0] for p in namen] for k in ("red", "green", "blue"))
    tmp = Path(str(ziel) + ".tmp")
    geschrieben = 0
    try:
        with tmp.open("w", encoding="ascii") as aus:
            aus.write("\n".join(_kopf(behalten, farbe, kommentare)) + "\n")
            for i, (p, c) in enumerate(_vertices(quelle)):
                if i % schritt:
                    continue
                if farbe:
                    aus.write(f"{_f(p[0])} {_f(p[1])} {_f(p[2])} {c[0]} {c[1]} {c[2]}\n")
                else:
                    aus.write(f"{_f(p[0])} {_f(p[1])} {_f(p[2])}\n")
                geschrieben += 1
        if geschrieben != behalten:
            raise PlyFehler(f"PLY lieferte {geschrieben} statt {behalten} Punkte.")
    except BaseException:
        tmp.unlink(missing_ok=True)       # keine halbe Wolke liegen lassen
        raise
    tmp.replace(ziel)
    return {"punkte": geschrieben, "punkte_original": gesamt, "ausgeduennt": schritt > 1}


def _kopf(n: int, farbe: bool, kommentare) -> list[str]:
    kopf = ["ply", "format ascii 1.0"]
    # PLY-Köpfe sind ASCII – Kommentare daher ohne Umlaute/Gedankenstriche.
    kopf += [f"comment {k.encode('ascii', 'replace').decode('ascii')}" for k in kommentare]
    kopf += [f"element vertex {n}", "property float x", "property float y", "property float z"]
    if farbe:
        kopf += ["property uchar red", "property uchar green", "property uchar blue"]
    kopf.append("end_header")
    return kopf


def _f(v: float) -> str:
    return f"{float(v):.7g}"
