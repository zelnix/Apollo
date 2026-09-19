package com.guarddog.core.net

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/** Shared vectors: security/test-vectors/normalization/host_vectors.json */
class HostCanonicalizerParityTest {
    private val vectors = File(System.getProperty("guarddog.vectors") ?: "../../../security/test-vectors")

    @Test fun hostVectors() {
        val root = Json.parseToJsonElement(File(vectors, "normalization/host_vectors.json").readText()).jsonObject
        for (v in root.getValue("vectors").jsonArray) {
            val o = v.jsonObject
            val input = o.getValue("input").jsonPrimitive.content
            val expected = o.getValue("expected").let { if (it.jsonPrimitive.isString) it.jsonPrimitive.content else null }
            assertEquals(expected, HostCanonicalizer.canonicalize(input), "${o["note"]}: $input")
        }
    }

    @Test fun ipv6IsReallyValidated() {
        assertEquals(null, HostCanonicalizer.canonicalize("not:an:ip:but:has:colons"))
        assertEquals("[2001:db8::1]", HostCanonicalizer.canonicalize("2001:0DB8:0000:0000:0000:0000:0000:0001"))
        assertEquals("[::ffff:c000:201]", HostCanonicalizer.canonicalize("::ffff:192.0.2.1"))
    }
}
