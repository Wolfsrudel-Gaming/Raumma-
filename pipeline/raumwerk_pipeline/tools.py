"""
Externe Werkzeuge der Pipeline und ihr gedrosselter Aufruf.

Die eigentliche Rekonstruktion machen CLI-Programme: COLMAP (Kameraposen +
spärliche Wolke) und OpenMVS (dichte Wolke). Diese Datei erkennt, ob sie
vorhanden sind, baut die realen Kommandozeilen und startet sie
**ressourcenschonend**: mit `nice` (CPU-Priorität) und `ionice` (I/O-Priorität),
damit die Pipeline andere Dienste auf dem geteilten Server nie aushungert
(Konzept §11).

Fehlt ein **benötigtes** Werkzeug, weicht die Pipeline in den Simulationsmodus
aus, statt zu scheitern. CloudCompare wird nur angezeigt – keine Stufe ruft es
heute auf, deshalb entscheidet es auch nicht über „echt" oder „Simulation".

**Ehrlich:** Der echte Pfad (COLMAP/OpenMVS) ist **nicht im CI getestet** – dort
sind die Binaries nicht installiert. Die Kommandozeilen entsprechen COLMAP 3.7
bis 3.11 und OpenMVS 2.x; die Tests prüfen den Ablauf mit nachgebauten
Werkzeug-Ausgaben.
"""

from __future__ import annotations

import resource
import shutil
import subprocess
from dataclasses import dataclass

from .config import Config

WERKZEUGE = {
    "colmap": "Structure-from-Motion (Kameraposen + spärliche Wolke) und Entzerrung",
    "openmvs": "Dichte Rekonstruktion (InterfaceCOLMAP + DensifyPointCloud)",
    "cloudcompare": "Registrierung mehrerer Wolken – optional, derzeit von keiner Stufe benutzt",
}

# Nur diese entscheiden über echten Lauf oder Simulation.
BENOETIGT = ("colmap", "openmvs")

# So heißt die dichte Wolke, die DensifyPointCloud aus `szene.mvs` macht.
SZENE = "szene.mvs"
DICHTE_PLY = "szene_dense.ply"


def vorhanden() -> dict[str, bool]:
    """Welche Werkzeuge auf diesem Rechner installiert sind."""
    return {
        "colmap": shutil.which("colmap") is not None,
        # OpenMVS liefert mehrere Binaries; beide werden aufgerufen.
        "openmvs": (shutil.which("InterfaceCOLMAP") is not None
                    and shutil.which("DensifyPointCloud") is not None),
        "cloudcompare": (shutil.which("CloudCompare") is not None
                         or shutil.which("cloudcompare") is not None),
    }


def alle_vorhanden() -> bool:
    """Sind alle Werkzeuge da, die der echte Lauf braucht? (ohne CloudCompare)"""
    v = vorhanden()
    return all(v[name] for name in BENOETIGT)


def colmap_kommandos(bilder_dir: str, arbeit_dir: str) -> list[list[str]]:
    """
    Die COLMAP-Schritte im **CPU-Modus** (Konzept §6.2): Merkmale, Zuordnung,
    Mapper → `sparse/0` (binär), dann `model_converter` → zusätzlich als Text,
    damit der Maß-Solver Punkte und Kamerazentren lesen kann (`modell.py`
    liest beide Formate; der Text ist zum Nachsehen bequemer).
    """
    db = f"{arbeit_dir}/datenbank.db"
    return [
        ["colmap", "feature_extractor", "--database_path", db,
         "--image_path", bilder_dir, "--SiftExtraction.use_gpu", "0"],
        ["colmap", "exhaustive_matcher", "--database_path", db,
         "--SiftMatching.use_gpu", "0"],
        ["colmap", "mapper", "--database_path", db,
         "--image_path", bilder_dir, "--output_path", f"{arbeit_dir}/sparse"],
        ["colmap", "model_converter", "--input_path", f"{arbeit_dir}/sparse/0",
         "--output_path", f"{arbeit_dir}/sparse/0", "--output_type", "TXT"],
    ]


def dichte_kommandos(bilder_dir: str, arbeit_dir: str) -> list[list[str]]:
    """
    Die dichte Wolke: erst entzerren (`image_undistorter` – OpenMVS erwartet
    entzerrte Bilder im COLMAP-Layout `dense/`), dann `InterfaceCOLMAP` →
    `szene.mvs`, dann `DensifyPointCloud` → `szene_dense.ply` (binär). Die
    Stufe wandelt diese Datei danach in die ASCII-`wolke.ply` für den
    Betrachter um.
    """
    dense = f"{arbeit_dir}/dense"
    return [
        ["colmap", "image_undistorter", "--image_path", bilder_dir,
         "--input_path", f"{arbeit_dir}/sparse/0", "--output_path", dense,
         "--output_type", "COLMAP"],
        ["InterfaceCOLMAP", "-i", dense, "-o", f"{arbeit_dir}/{SZENE}",
         "--image-folder", f"{dense}/images", "-w", arbeit_dir],
        ["DensifyPointCloud", f"{arbeit_dir}/{SZENE}", "-w", arbeit_dir,
         "--resolution-level", "2"],
    ]


@dataclass
class Lauf:
    kommando: list[str]
    rueckgabe: int
    ausgabe: str


def rlimits_setzen(cfg: Config):
    """Als preexec im Kindprozess: RAM hart deckeln (cgroup-Ergänzung)."""
    def _setzen():
        grenze = cfg.max_ram_mb * 1024 * 1024
        try:
            resource.setrlimit(resource.RLIMIT_AS, (grenze, grenze))
        except (ValueError, OSError):
            pass
    return _setzen


def gedrosselt(kommando: list[str], cfg: Config) -> list[str]:
    """
    Das Kommando in `nice`/`ionice` wickeln, soweit vorhanden. So bekommt die
    schwere Rechnung die niedrigste Priorität und läuft nur, wenn CPU und
    Platte ohnehin frei sind.
    """
    vorn: list[str] = []
    if shutil.which("nice"):
        vorn += ["nice", "-n", str(cfg.nice_level)]
    if shutil.which("ionice"):
        vorn += ["ionice", "-c", str(cfg.ionice_klasse)]
    return vorn + kommando


def ausfuehren(kommando: list[str], cfg: Config, cwd: str | None = None) -> Lauf:
    """Ein Kommando gedrosselt und ram-begrenzt starten."""
    ganz = gedrosselt(kommando, cfg)
    try:
        fertig = subprocess.run(
            ganz, cwd=cwd, capture_output=True, text=True,
            preexec_fn=rlimits_setzen(cfg),
        )
    except OSError as e:          # Binary fehlt / nicht ausführbar
        return Lauf(kommando=ganz, rueckgabe=127, ausgabe=str(e))
    return Lauf(kommando=ganz, rueckgabe=fertig.returncode,
                ausgabe=(fertig.stdout or "") + (fertig.stderr or ""))
