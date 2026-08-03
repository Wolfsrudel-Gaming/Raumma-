"""
Jobs und ihre Ablage.

Ein Job ist ein Aufmaß-Auftrag: hochgeladene Aufnahmen plus Lasermaße gehen
rein, ein metrisch skaliertes Ergebnis kommt heraus. Der Zustand liegt als
JSON je Job auf der Platte – schlicht, nachvollziehbar und ohne Datenbank, wie
der Rest des Kerns.
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .config import Config

# Zustände eines Jobs.
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

    def dir(self, job_id: str) -> Path:
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

    def neu(self, name: str, eingabe: dict) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], name=name or "Auftrag", eingabe=eingabe)
        self.dir(job.id).mkdir(parents=True, exist_ok=True)
        self.speichern(job)
        return job

    def speichern(self, job: Job) -> None:
        job.geaendert = time.time()
        pfad = self.dir(job.id) / "job.json"
        pfad.write_text(json.dumps(job.dict(), indent=2, ensure_ascii=False), encoding="utf-8")

    def laden(self, job_id: str) -> Job | None:
        pfad = self.dir(job_id) / "job.json"
        if not pfad.exists():
            return None
        return Job(**json.loads(pfad.read_text(encoding="utf-8")))

    def alle(self) -> list[Job]:
        jobs = []
        for d in sorted(self.cfg.jobs_dir().glob("*/job.json")):
            try:
                jobs.append(Job(**json.loads(d.read_text(encoding="utf-8"))))
            except (ValueError, OSError):
                continue
        return sorted(jobs, key=lambda j: j.erstellt, reverse=True)

    def wartende(self) -> list[Job]:
        return [j for j in self.alle() if j.status == WARTET]
