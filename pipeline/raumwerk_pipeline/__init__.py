"""
RAUMWERK-Pipeline (Schicht ② des Konzepts) – Verarbeitung auf dem CPU-Server.

Ein schlankes, abhängigkeitsfreies Gerüst: Job-Queue mit einem Worker, die
Stufen Raum (Polygonzug) → SfM → Dichte Wolke → Maß-Solver → Komponenten →
Semantik, gedrosselt per nice/ionice und in Docker mit CPU/RAM-Limits gekapselt.

Ohne COLMAP/OpenMVS läuft alles im **Simulationsmodus** durch – jede daraus
stammende Zahl ist als `simuliert` gekennzeichnet. Echt gerechnet sind immer:
der Raumvorschlag aus eingegebenen Wandlängen, die Komponenten-Zuordnung und –
sobald die Rekonstruktion Modellpunkte liefert – der Maßstab. Für den Maßstab
reicht eine einzige bekannte Länge; ein Referenzwürfel ist nicht nötig.
"""

__version__ = "0.2.0"
