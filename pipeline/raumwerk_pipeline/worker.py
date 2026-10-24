"""
Job-Queue mit **einem** Worker (Konzept §11).

Schwere Jobs laufen nacheinander, nie parallel – so kann die Pipeline die
anderen Dienste auf dem geteilten Server nicht aushungern. Der Worker läuft mit
niedriger Priorität (`os.nice`) und wartet, wenn ein Nacht-Fenster gesetzt ist,
bis es soweit ist (§11: „laufen bevorzugt nachts").

Neustart-fest: Beim Start werden wartende Aufträge eingereiht; ein Auftrag, der
beim Beenden mitten im Lauf war (`laeuft`), wird von vorn gerechnet. Aufträge
im Zustand `angelegt` (auto:false, Bilder kommen noch) bleiben liegen, bis
`POST /jobs/<id>/start` sie freigibt.
"""

from __future__ import annotations

import os
import queue
import sys
import threading
import time
import traceback
from datetime import datetime

from .config import Config
from .jobs import LAEUFT, WARTET, JobStore
from .pipeline import run_job


class Worker:
    def __init__(self, store: JobStore, cfg: Config):
        self.store = store
        self.cfg = cfg
        self._queue: "queue.Queue[str | None]" = queue.Queue()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def start(self) -> "Worker":
        # Beim Start alle wartenden Jobs einreihen (Neustart-fest). Ein beim
        # Beenden unterbrochener Lauf beginnt von vorn – sonst hinge er ewig
        # auf „laeuft" fest.
        for job in reversed(self.store.alle()):
            if job.status == LAEUFT:
                self.store.zuruecksetzen(job)
            if job.status == WARTET:
                self._queue.put(job.id)
        self._thread = threading.Thread(target=self._schleife, name="raumwerk-worker", daemon=True)
        self._thread.start()
        return self

    def einreihen(self, job_id: str) -> None:
        self._queue.put(job_id)

    def stop(self) -> None:
        self._stop.set()
        self._queue.put(None)
        if self._thread:
            self._thread.join(timeout=5)

    def leerlauf(self, timeout: float = 30.0) -> bool:
        """Wartet, bis die Queue abgearbeitet ist (für Tests/CLI)."""
        ende = time.time() + timeout
        while time.time() < ende:
            if self._queue.unfinished_tasks == 0:
                return True
            time.sleep(0.05)
        return False

    # --------------------------------------------------------- intern

    def _schleife(self) -> None:
        try:
            os.nice(self.cfg.nice_level)   # niedrige CPU-Priorität für den Worker
        except (OSError, AttributeError):
            pass
        while not self._stop.is_set():
            job_id = self._queue.get()
            if job_id is None:
                self._queue.task_done()
                break
            try:
                self._warte_auf_fenster()
                # Prüfen und auf „laeuft" setzen unter derselben Sperre wie
                # POST /start – sonst könnte ein Neustart einen Lauf überholen.
                with self.store.sperre:
                    job = self.store.laden(job_id)
                    if not job or job.status != WARTET:
                        continue
                    job.status = LAEUFT
                    self.store.speichern(job)
                run_job(job, self.store, self.cfg)
            except Exception:  # noqa: BLE001 – ein kaputter Auftrag darf den Worker nicht beenden
                traceback.print_exc(file=sys.stderr)
            finally:
                self._queue.task_done()

    def _warte_auf_fenster(self) -> None:
        fenster = self.cfg.nacht_fenster
        if not fenster:
            return
        start, ende = fenster
        while not self._stop.is_set():
            stunde = datetime.now().hour
            drin = start <= stunde < ende if start < ende else (stunde >= start or stunde < ende)
            if drin:
                return
            time.sleep(30)
