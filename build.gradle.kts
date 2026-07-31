/*
 * Eigenständiges Gradle-Projekt.
 *
 * Der Kern hat **keine** Laufzeit-Abhängigkeiten ausser der Kotlin-Standard-
 * bibliothek. Das ist Absicht: Er soll sich in ein Spring-Boot-Projekt, in
 * einen Ktor-Server oder in ein Desktop-Programm gleichermassen übernehmen
 * lassen, ohne dass eine fremde Bibliothek mitkommt.
 *
 * Zum Übernehmen genügt der Ordner `src/main/kotlin` – die restlichen Dateien
 * (Tests, SQL, Web, Doku) sind Beigabe.
 */
plugins {
    kotlin("jvm") version "2.0.21"
}

group = "de.aufmass"
version = "1.0.0"

java {
    toolchain { languageVersion = JavaLanguageVersion.of(21) }
}

repositories { mavenCentral() }

dependencies {
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
    testLogging { events("passed", "failed") }
}
