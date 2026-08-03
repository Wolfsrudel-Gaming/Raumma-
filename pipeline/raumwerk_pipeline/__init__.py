"""
RAUMWERK-Pipeline (Schicht ② des Konzepts) – Verarbeitung auf dem CPU-Server.

Ein schlankes, abhängigkeitsfreies Gerüst: Job-Queue mit einem Worker, die
Stufen SfM → Dichte Wolke → Maß-Solver → Komponenten → Semantik, gedrosselt per
nice/ionice und in Docker mit CPU/RAM-Limits gekapselt. Ohne COLMAP/OpenMVS
läuft alles im Simulationsmodus durch; der Maß-Solver rechnet immer echt.
"""

__version__ = "0.1.0"
