"""
Ablauf eines Jobs: die Stufen der Reihe nach, mit Fortschritt und Ergebnis.

Nachsichtig gegenüber Fehlern einer Stufe: Der Job geht auf `fehler` mit
Klartext, statt den ganzen Worker zu reißen – der nächste Auftrag läuft weiter.
"""

from __future__ import annotations

import json
import traceback

from .config import Config
from .jobs import FEHLER, FERTIG, LAEUFT, Job, JobStore
from .stages import STUFEN, simuliert


def run_job(job: Job, store: JobStore, cfg: Config) -> Job:
    job.status = LAEUFT
    job.fortschritt = 0.0
    job.fehler = ""
    store.speichern(job)

    jobdir = store.dir(job.id)
    ctx: dict = {}
    try:
        for i, (name, funktion) in enumerate(STUFEN):
            job.stufe = name
            job.fortschritt = round(i / len(STUFEN), 3)
            store.speichern(job)
            job.ergebnis.update(funktion(job, ctx, cfg, jobdir))
            store.speichern(job)

        job.ergebnis["viewer"] = {
            "wolke": job.ergebnis.get("wolke", {}).get("datei"),
            "skala_m_je_einheit": job.ergebnis.get("massstab", {}).get("skala_m_je_einheit"),
            "hinweis": "Freiräume sind konservativ (untere Schranke) auszugeben.",
        }
        job.ergebnis["modus"] = "simulation" if simuliert(cfg) else "echt"
        job.status = FERTIG
        job.stufe = "fertig"
        job.fortschritt = 1.0
    except Exception as e:  # noqa: BLE001 – Klartext statt Absturz
        job.status = FEHLER
        job.fehler = f"{e}"
        (jobdir / "fehler.log").write_text(traceback.format_exc(), encoding="utf-8")

    store.speichern(job)
    (jobdir / "result.json").write_text(
        json.dumps(job.ergebnis, indent=2, ensure_ascii=False), encoding="utf-8")
    return job
