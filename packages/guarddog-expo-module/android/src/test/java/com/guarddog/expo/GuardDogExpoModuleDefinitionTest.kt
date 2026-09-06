package com.guarddog.expo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Module-registration regression test (physical-device blocker found on the M1 proof phone).
 *
 * Compilation alone is NOT sufficient evidence that the Expo bridge can load: Expo SDK 57 resolves argument/return types of
 * Function/AsyncFunction registrations through the Pika compiler plugin. When a module is built without that plugin, the
 * inlined `typeDescriptorOf<T>()` stubs survive in `definition()` bytecode and the first evaluation throws
 * "This function has a reified type parameter and thus can only be inlined at compilation time, not called directly."
 *
 * This test executes the REAL `GuardDogExpoModule().definition()` (no mock module) — exactly what Expo's ModuleHolder does at
 * app start — and additionally inspects the compiled class for the surviving reified stubs.
 */
class GuardDogExpoModuleDefinitionTest {

    @Test
    fun `definition evaluates and registers the GuardDogSecurity surface`() {
        val definition = GuardDogExpoModule().definition() // throws on the pre-fix build

        assertEquals("GuardDogSecurity", definition.name)
        assertEquals(
            setOf("getCapabilities", "getProtectionState", "configure", "acceptRuleBundle", "analyzeUrl", "getEnforcementStats", "getRecoveryStatus"),
            definition.syncFunctions.keys,
        )
        // Expo appends startObserving/stopObserving when Events(...) is declared; assert our surface is present.
        assertTrue(
            definition.asyncFunctions.keys.containsAll(setOf("requestPermission", "startProtection", "stopProtection", "getBuildProvenance")),
        )
        val events = definition.eventsDefinition
        assertNotNull("Events(...) must be registered", events)
        assertTrue(events!!.names.contains(GuardDogExpoModule.EVENT_SECURITY))
        assertTrue(events.names.contains(GuardDogExpoModule.EVENT_STATE))
    }

    @Test
    fun `compiled definition contains no un-inlined reified type stubs`() {
        val bytes = GuardDogExpoModule::class.java.getResourceAsStream("GuardDogExpoModule.class")!!.use { it.readBytes() }
        val text = String(bytes, Charsets.ISO_8859_1)
        assertFalse("Intrinsics.reifiedOperationMarker survived in GuardDogExpoModule.class (Pika compiler plugin not applied)", text.contains("reifiedOperationMarker"))
        assertFalse("pika throwNonReified*Error stub survived in GuardDogExpoModule.class", text.contains("throwNonReified"))
    }
}
