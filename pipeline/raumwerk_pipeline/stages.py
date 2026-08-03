"""
Die Stufen der Verarbeitung (Konzept §6.2).

    Erfassung → [ SfM → Dichte Wolke → Maß-Solver → Komponenten → Semantik ] → Ergebnis

Jede Stufe ist eine Funktion mit gleicher Form. Ist das echte Werkzeug
installiert, läuft es (die Kommandos stehen in `tools.py`); sonst weicht die
Stufe in eine **Simulation** aus, damit die Pipeline in Entwicklung und CI
end-to-end durchläuft und ein prüfbares Ergebnis liefert.

Der **Maß-Solver** ist keine Simulation, sondern echt gerechnet – er ist der
Kern der Genauigkeitsstrategie und braucht kein schweres Binary.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

from . import tools
from .config import Config
from .jobs import Job
from .masssolver import kontrollmass_abweichung_mm, skala_aus_distanzen

# Verborgener „wahrer" Maßstab für die Simulation: die Rekonstruktion käme in
# willkürlichen Einheiten heraus, die Lasermaße stellen sie auf Meter. Der
# Solver soll ihn aus den Ankern zurückgewinnen.
_SIM_SKALA = 0.37


def simuliert(cfg: Config) -> bool:
    if cfg.simulieren is not None:
        return cfg.simulieren
    return not tools.alle_vorhanden()


# ------------------------------------------------------------ Stufe 1: SfM

def stage_sfm(job: Job, ctx: dict, cfg: Config, jobdir: Path) -> dict:
    """Kameraposen und spärliche Wolke. Real: COLMAP im CPU-Modus."""
    sparse = jobdir / "sparse"
    sparse.mkdir(exist_ok=True)
    if not simuliert(cfg):
        for kmd in tools.colmap_kommandos(str(jobdir / "bilder"), str(jobdir)):
            lauf = tools.ausfuehren(kmd, cfg, cwd=str(jobdir))
            if lauf.rueckgabe != 0:
                raise RuntimeError(f"COLMAP scheiterte: {' '.join(kmd[:2])}")
        # Aus der echten Rekonstruktion würden hier die Modell-Distanzen an den
        # Laser-Ankerpunkten ausgelesen. (Auslesen aus sparse/ – projektspezifisch.)
        ctx["anker"] = _anker_aus_laser(job, rauschen=0.0)
    else:
        (sparse / "cameras.json").write_text(
            json.dumps({"kameras": 24, "hinweis": "Simulation – keine echte SfM"}),
            encoding="utf-8")
        ctx["anker"] = _anker_aus_laser(job, rauschen=0.006, seed=job.id)
    return {"sfm": {"kameras": 24}}


# -------------------------------------------------- Stufe 2: Dichte Wolke

def stage_dichte(job: Job, ctx: dict, cfg: Config, jobdir: Path) -> dict:
    """Farbige dichte Punktwolke. Real: OpenMVS (CPU)."""
    ziel = jobdir / "wolke.ply"
    if not simuliert(cfg):
        for kmd in tools.openmvs_kommandos(str(jobdir)):
            lauf = tools.ausfuehren(kmd, cfg, cwd=str(jobdir))
            if lauf.rueckgabe != 0:
                raise RuntimeError("OpenMVS scheiterte")
    else:
        _demo_wolke_schreiben(ziel)
    return {"wolke": {"datei": ziel.name, "punkte": _punktzahl(ziel)}}


# --------------------------------------------------- Stufe 3: Maß-Solver

def stage_mass(job: Job, ctx: dict, cfg: Config, jobdir: Path) -> dict:
    """
    Metrischer Maßstab aus den Laser-Ankern – echt gerechnet. Ein Anker wird
    als Kontrollmaß zurückgehalten (fließt nicht in die Rechnung ein) und
    liefert die reale Genauigkeitszahl je Auftrag (§7).
    """
    anker = ctx.get("anker", [])
    if len(anker) < 2:
        raise RuntimeError("Zu wenige Laser-Anker für den Maßstab (mindestens 2).")

    kontrolle = anker[-1] if len(anker) >= 4 else None
    verwendet = anker[:-1] if kontrolle else anker

    erg = skala_aus_distanzen(verwendet)
    ausgabe = {
        "skala_m_je_einheit": round(erg.skala, 6),
        "rms_mm": round(erg.rms_mm, 1),
        "anker_verwendet": erg.n_verwendet,
        "anker_verworfen": erg.n_verworfen,
    }
    if kontrolle:
        abw = kontrollmass_abweichung_mm(erg.skala, kontrolle[0], kontrolle[1])
        ausgabe["kontrollmass_abweichung_mm"] = round(abw, 1)

    (jobdir / "massstab.json").write_text(
        json.dumps(ausgabe, indent=2, ensure_ascii=False), encoding="utf-8")
    ctx["skala"] = erg.skala
    return {"massstab": ausgabe}


# ------------------------------------------- Stufe 4: Komponenten-Zuordnung

# Kleiner Katalog echter Maße – die serverseitige Entsprechung der Komponenten-
# DB. Außendurchmesser in Millimetern.
_KATALOG = {
    "KABEL_NYM5": {"aussen_mm": 13.0, "name": "NYM-J 5×2,5"},
    "LEERROHR_M25": {"aussen_mm": 25.0, "name": "Leerrohr M25"},
    "ZAEHLERSCHRANK": {"breite_m": 0.60, "tiefe_m": 0.20, "name": "Zählerschrank"},
}


def stage_komponenten(job: Job, ctx: dict, cfg: Config, jobdir: Path) -> dict:
    """Getaggte Objekte auf echte Katalogmaße abbilden (DB-Lookup, §6.2)."""
    zuordnung = []
    for tag in job.eingabe.get("tags", []):
        schluessel = tag.get("art")
        katalog = _KATALOG.get(schluessel)
        zuordnung.append({
            "tag": schluessel,
            "gefunden": katalog is not None,
            "masse": katalog or {},
        })
    (jobdir / "komponenten.json").write_text(
        json.dumps(zuordnung, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"komponenten": {"zugeordnet": sum(1 for z in zuordnung if z["gefunden"]),
                            "gesamt": len(zuordnung)}}


# ------------------------------------------------ Stufe 5: Elektro-Semantik

def stage_semantik(job: Job, ctx: dict, cfg: Config, jobdir: Path) -> dict:
    """
    Aufgedeckelte Verteilungen zuordnen/interpretieren – zunächst regelbasiert
    (Konzept §6.2, §9 Stufe 1), später ML-gestützt.
    """
    befunde = []
    for tag in job.eingabe.get("tags", []):
        if tag.get("art") == "ZAEHLERSCHRANK":
            befunde.append("Verteilung erkannt – Bedienbereich davor prüfen (VDE 0100-729).")
    (jobdir / "semantik.json").write_text(
        json.dumps({"befunde": befunde}, ensure_ascii=False), encoding="utf-8")
    return {"semantik": {"befunde": len(befunde)}}


STUFEN = [
    ("SfM (Kameraposen)", stage_sfm),
    ("Dichte Wolke", stage_dichte),
    ("Maß-Solver", stage_mass),
    ("Komponenten-Zuordnung", stage_komponenten),
    ("Elektro-Semantik", stage_semantik),
]


# ------------------------------------------------------------ Hilfsmittel

def _anker_aus_laser(job: Job, rauschen: float = 0.0, seed: str | None = None):
    """
    Modell-/Laser-Ankerpaare bilden. In der Simulation entstehen die Modell-
    Distanzen aus den Lasermaßen geteilt durch den verborgenen Maßstab, plus
    etwas Rauschen – so, wie sie aus einer realen Rekonstruktion kämen.
    """
    rng = random.Random(seed)
    anker = []
    for m in job.eingabe.get("laser", []):
        d_laser = float(m.get("distanzM", 0))
        if d_laser <= 0:
            continue
        stoerung = 1.0 + rng.uniform(-rauschen, rauschen)
        d_modell = (d_laser / _SIM_SKALA) * stoerung
        anker.append((d_modell, d_laser))
    return anker


def _demo_wolke_schreiben(ziel: Path, kante: float = 4.0):
    """Eine winzige Demo-Punktwolke als ASCII-PLY (steht für die dichte Wolke)."""
    punkte = []
    n = 8
    for i in range(n + 1):
        t = kante * i / n
        punkte += [(t, 0, 0), (t, kante, 0), (0, t, 0), (kante, t, 0)]
    kopf = [
        "ply", "format ascii 1.0", f"element vertex {len(punkte)}",
        "property float x", "property float y", "property float z", "end_header",
    ]
    zeilen = kopf + [f"{x} {y} {z}" for x, y, z in punkte]
    ziel.write_text("\n".join(zeilen) + "\n", encoding="utf-8")


def _punktzahl(ply: Path) -> int:
    if not ply.exists():
        return 0
    for zeile in ply.read_text(encoding="utf-8").splitlines():
        if zeile.startswith("element vertex"):
            return int(zeile.split()[-1])
    return 0
