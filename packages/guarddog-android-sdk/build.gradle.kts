// Root build for the standalone Android SDK (used by scripts/ci/android-native-gate.sh).
// Generate the wrapper on the build machine: `gradle wrapper --gradle-version 8.9`.
plugins {
    id("com.android.library") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.0.21" apply false
}

// Fails the build if :guarddog-core ever gains a dependency on :guarddog-vpn (PF-01 gate).
gradle.projectsEvaluated {
    val core = project(":guarddog-core")
    val offending = core.configurations.flatMap { it.dependencies }.filterIsInstance<ProjectDependency>()
        .filter { it.dependencyProject.path == ":guarddog-vpn" }
    check(offending.isEmpty()) { ":guarddog-core must not depend on :guarddog-vpn" }
}
