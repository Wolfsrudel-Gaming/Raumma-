# RAUMWERK-Pipeline – Schicht ② (Verarbeitung), CPU-only.
#
# Bewusst schlank: Basis Debian + Python-Standardbibliothek, keine
# Fremdpakete. COLMAP/OpenMVS sind hier NICHT installiert (sie sind schwer und
# teils selbst zu bauen) – die Pipeline läuft dann im Simulationsmodus. Zum
# Scharfschalten die Werkzeuge ergänzen, z. B.:
#
#     RUN apt-get update && apt-get install -y colmap
#     # OpenMVS nach Projekt-Anleitung bauen und ins PATH legen
#
# util-linux bringt `ionice`, `nice` steckt in coreutils (im Basis-Image).
FROM debian:12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 util-linux ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Eigener, unprivilegierter Nutzer – Trennung vom restlichen Servergeschehen
# (Konzept §11).
RUN useradd -m -u 10001 raumwerk
WORKDIR /app
COPY --chown=raumwerk:raumwerk raumwerk_pipeline ./raumwerk_pipeline

ENV RAUMWERK_DATEN=/daten \
    RAUMWERK_MAX_CPUS=2 \
    RAUMWERK_MAX_RAM_MB=4096 \
    RAUMWERK_NICE=15 \
    RAUMWERK_IONICE=3

RUN mkdir -p /daten && chown raumwerk:raumwerk /daten
VOLUME ["/daten"]
USER raumwerk
EXPOSE 8781

ENTRYPOINT ["python3", "-m", "raumwerk_pipeline"]
CMD ["serve", "8781"]
