"""
Jobs und ihre Ablage.

Ein Job ist ein Aufmaß-Auftrag: hochgeladene Aufnahmen plus bekannte Längen
(Laser, Bandmaß, Kamerahöhe) gehen rein, ein metrisch skaliertes Ergebnis kommt
heraus. Der Zustand liegt als
JSON je Job auf der Platte – schlicht, nachvollziehbar und ohne Datenbank, wie
der Rest des Kerns.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .config import Config

# Zustände eines Jobs.
#   angelegt → (POST /start) → wartet → laeuft → fertig | fehler
# „angelegt" heißt: Auftrag mit auto:false, Bilder kommen noch – der Worker
# rührt ihn nicht an, auch nicht nach einem Neustart, bis /start kommt.
ANGELEGT = "angelegt"
WARTET = "wartet"
LAEUFT = "laeuft"
FERTIG = "fertig"
FEHLER = "fehler"


@dataclass
class Job:
    id: str
    name: str
    status: str = WARTET
    stufe: str = ""                 # aktuelle Pipeline-Stufe
    fortschritt: float = 0.0        # 0…1
    erstellt: float = field(default_factory=time.time)
    geaendert: float = field(default_factory=time.time)
    eingabe: dict = field(default_factory=dict)   # laser, tags, simulieren …
    ergebnis: dict = field(default_factory=dict)  # skala, genauigkeit, artefakte
    fehler: str = ""

    def dict(self) -> dict:
        return asdict(self)


class JobStore:
    """Legt Jobs an, lädt und speichert sie. Ein Verzeichnis je Job."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        cfg.vorbereiten()
        # Schützt Zustandswechsel (prüfen + schreiben) zwischen Server-Threads
        # und Worker, z. B. „/start nur, wenn nicht gerade läuft".
        self.sperre = threading.RLock()

    @staticmethod
    def gueltige_id(job_id: str) -> bool:
        """Job-IDs sind 12 Hex-Zeichen – alles andere (z. B. `..`) ist kein Auftrag."""
        return bool(_ID.fullmatch(job_id or ""))

    def dir(self, job_id: str) -> Path:
        if not self.gueltige_id(job_id):
            raise ValueError(f"ungültige Auftrags-ID: {job_id!r}")
        return self.cfg.jobs_dir() / job_id

    def bilder_dir(self, job_id: str) -> Path:
        d = self.dir(job_id) / "bilder"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def bilder(self, job_id: str) -> list[str]:
        d = self.dir(job_id) / "bilder"
        if not d.exists():
            return []
        return sorted(p.name for p in d.iterdir() if p.is_file())

    def neu(self, name: str, eingabe: dict, status: str = WARTET) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], name=name or "Auftrag", eingabe=eingabe,
                  status=status)
        self.dir(job.id).mkdir(parents=True, exist_ok=True)
        self.speichern(job)
        return job

    def speichern(self, job: Job) -> None:
        job.geaendert = time.time()
        pfad = self.dir(job.id) / "job.json"
        # Atomar ersetzen: Server-Threads lesen job.json, während der Worker schreibt.
        tmp = pfad.with_name(f"job.json.{threading.get_ident()}.tmp")
        tmp.write_text(json.dumps(job.dict(), indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, pfad)

    def laden(self, job_id: str) -> Job | None:
        if not self.gueltige_id(job_id):
            return None
        pfad = self.dir(job_id) / "job.json"
        if not pfad.exists():
            return None
        return Job(**json.loads(pfad.read_text(encoding="utf-8")))

    def alle(self) -> list[Job]:
        jobs = []
        for d in sorted(self.cfg.jobs_dir().glob("*/job.json")):
            try:
                jobs.append(Job(**json.loads(d.read_text(encoding="utf-8"))))
            except (ValueError, TypeError, OSError):
                continue
        return sorted(jobs, key=lambda j: j.erstellt, reverse=True)

    def wartende(self) -> list[Job]:
        return [j for j in self.alle() if j.status == WARTET]

    def zuruecksetzen(self, job: Job) -> Job:
        """Für einen (Neu-)Start: zurück auf `wartet`, altes Ergebnis verwerfen."""
        job.status = WARTET
        job.stufe = ""
        job.fortschritt = 0.0
        job.fehler = ""
        job.ergebnis = {}
        self.speichern(job)
        return job


_ID = re.compile(r"[0-9a-f]{12}")
