"""
Externe Werkzeuge der Pipeline und ihr gedrosselter Aufruf.

Die eigentliche Rekonstruktion machen CLI-Programme (COLMAP, OpenMVS,
CloudCompare). Diese Datei erkennt, ob sie vorhanden sind, baut die realen
Kommandozeilen und startet sie **ressourcenschonend**: mit `nice` (CPU-
Priorität) und `ionice` (I/O-Priorität), damit die Pipeline andere Dienste auf
dem geteilten Server nie aushungert (Konzept §11).

Fehlt ein Werkzeug, meldet die Erkennung das – die Pipeline weicht dann in den
Simulationsmodus aus, statt zu scheitern.
"""

from __future__ import annotations

import resource
import shutil
import subprocess
from dataclasses import dataclass

from .config import Config

WERKZEUGE = {
    "colmap": "Structure-from-Motion (Kameraposen + spärliche Wolke)",
    "openmvs": "Dichte Rekonstruktion (farbige Punktwolke)",
    "cloudcompare": "Registrierung / Ausrichtung mehrerer Wolken",
}


def vorhanden() -> dict[str, bool]:
    """Welche Werkzeuge auf diesem Rechner installiert sind."""
    treffer = {}
    treffer["colmap"] = shutil.which("colmap") is not None
    # OpenMVS liefert mehrere Binaries; DensifyPointCloud ist das zentrale.
    treffer["openmvs"] = shutil.which("DensifyPointCloud") is not None
    treffer["cloudcompare"] = (
        shutil.which("CloudCompare") is not None or shutil.which("cloudcompare") is not None
    )
    return treffer


def alle_vorhanden() -> bool:
    return all(vorhanden().values())


def colmap_kommandos(bilder_dir: str, arbeit_dir: str) -> list[list[str]]:
    """
    Die realen COLMAP-Schritte im **CPU-Modus** (Konzept §6.2). Dokumentiert und
    einsatzbereit; wird ausgeführt, sobald `colmap` installiert ist.
    """
    db = f"{arbeit_dir}/datenbank.db"
    return [
        ["colmap", "feature_extractor", "--database_path", db,
         "--image_path", bilder_dir, "--SiftExtraction.use_gpu", "0"],
        ["colmap", "exhaustive_matcher", "--database_path", db,
         "--SiftMatching.use_gpu", "0"],
        ["colmap", "mapper", "--database_path", db,
         "--image_path", bilder_dir, "--output_path", f"{arbeit_dir}/sparse"],
    ]


def openmvs_kommandos(arbeit_dir: str) -> list[list[str]]:
    """Reale OpenMVS-Schritte (dichte Wolke), ressourcenlimitiert."""
    szene = f"{arbeit_dir}/szene.mvs"
    return [
        ["InterfaceCOLMAP", "-i", f"{arbeit_dir}/sparse/0", "-o", szene],
        ["DensifyPointCloud", szene, "--resolution-level", "2"],
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
    fertig = subprocess.run(
        ganz, cwd=cwd, capture_output=True, text=True,
        preexec_fn=rlimits_setzen(cfg),
    )
    return Lauf(kommando=ganz, rueckgabe=fertig.returncode,
               ausgabe=(fertig.stdout or "") + (fertig.stderr or ""))
