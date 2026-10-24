"""
Ablauf eines Jobs: die Stufen der Reihe nach, mit Fortschritt und Ergebnis.

Nachsichtig gegenüber Fehlern einer Stufe: Der Job geht auf `fehler` mit
Klartext, statt den ganzen Worker zu reißen – der nächste Auftrag läuft weiter.
Was bis dahin feststand (z. B. ein Raumvorschlag aus Bandmaßen), bleibt im
Ergebnis stehen.
"""

from __future__ import annotations

import json
import shutil
import traceback
from pathlib import Path

from .config import Config
from .jobs import FEHLER, FERTIG, LAEUFT, Job, JobStore
from .stages import SIM_HINWEIS, STUFEN, simuliert


def run_job(job: Job, store: JobStore, cfg: Config) -> Job:
    job.status = LAEUFT
    job.stufe = ""
    job.fortschritt = 0.0
    job.fehler = ""
    sim = simuliert(cfg)
    # Ein Neustart rechnet von vorn – nichts aus einem früheren Lauf bleibt kleben.
    job.ergebnis = {
        "modus": "simulation" if sim else "echt",
        "simuliert": sim,
        "hinweis": SIM_HINWEIS if sim else None,
    }
    store.speichern(job)

    jobdir = store.dir(job.id)
    ctx: dict = {"simuliert": sim, "hinweise": []}
    try:
        _aufraeumen(jobdir)
        for i, (name, funktion) in enumerate(STUFEN):
            job.stufe = name
            job.fortschritt = round(i / len(STUFEN), 3)
            store.speichern(job)
            job.ergebnis.update(funktion(job, ctx, cfg, jobdir))
            job.ergebnis["hinweise"] = list(dict.fromkeys(ctx["hinweise"]))
            store.speichern(job)

        massstab = job.ergebnis.get("massstab", {})
        job.ergebnis["viewer"] = {
            "wolke": job.ergebnis.get("wolke", {}).get("datei"),
            "skala_m_je_einheit": massstab.get("skala_m_je_einheit"),
            "kontrollmass_abweichung_mm": massstab.get("kontrollmass_abweichung_mm"),
            "simuliert": sim,
            "hinweis": (SIM_HINWEIS + " – Wolke und Maßstab sind Demo-Werte.") if sim else
                       "Freiräume sind konservativ (untere Schranke) auszugeben.",
        }
        job.status = FERTIG
        job.stufe = "fertig"
        job.fortschritt = 1.0
    except Exception as e:  # noqa: BLE001 – Klartext statt Absturz
        job.status = FEHLER
        job.fehler = f"{e}"
        job.ergebnis["fehler"] = job.fehler
        job.ergebnis["fehler_stufe"] = job.stufe
        job.ergebnis["hinweise"] = list(dict.fromkeys(ctx["hinweise"]))
        (jobdir / "fehler.log").write_text(traceback.format_exc(), encoding="utf-8")

    store.speichern(job)
    (jobdir / "result.json").write_text(
        json.dumps(job.ergebnis, indent=2, ensure_ascii=False), encoding="utf-8")
    return job


def _aufraeumen(jobdir: Path) -> None:
    """
    Abgeleitete Dateien eines früheren Laufs entfernen (Wolke, Manifeste,
    COLMAP-Datenbank, sparse/, dense/ …). Eingaben bleiben: `job.json` und
    `bilder/`. Sonst läge nach einem gescheiterten Neustart noch die alte Wolke
    unter /wolke.ply.
    """
    for p in jobdir.iterdir():
        if p.name == "bilder" or p.name.startswith("job.json"):
            continue
        if p.is_dir() and not p.is_symlink():
            shutil.rmtree(p, ignore_errors=True)
        else:
            p.unlink(missing_ok=True)
