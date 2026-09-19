pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositories { google(); mavenCentral() }
}
rootProject.name = "guarddog-android-sdk"
include(":guarddog-core")
include(":guarddog-vpn")
// Dependency direction is one-way: :guarddog-vpn -> :guarddog-core. Never the reverse.
