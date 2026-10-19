package com.guarddog.core.net

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** Shared vectors: security/test-vectors/normalization/url_vectors.json */
class UrlSanitizerParityTest {
    private val vectors = File(System.getProperty("guarddog.vectors") ?: "../../../security/test-vectors")

    @Test fun urlVectors() {
        val root = Json.parseToJsonElement(File(vectors, "normalization/url_vectors.json").readText()).jsonObject
        for (v in root.getValue("vectors").jsonArray) {
            val o = v.jsonObject
            val input = o.getValue("input").jsonPrimitive.content
            val analyzable = o.getValue("analyzable").jsonPrimitive.content.toBoolean()
            val expectedUrl = o.getValue("sanitizedUrl").let { if (it is JsonNull) null else it.jsonPrimitive.content }
            val expectedHost = o.getValue("host").let { if (it is JsonNull) null else it.jsonPrimitive.content }
            val r = UrlSanitizer.sanitize(input)
            assertEquals(analyzable, r != null, input)
            assertEquals(expectedUrl, r?.sanitizedUrl, input)
            assertEquals(expectedHost, r?.host, input)
        }
    }

    @Test fun originalRemainsAnalyzableWhileSharedFormDropsSecrets() {
        val r = UrlSanitizer.sanitize("https://user:pw@example.com/login?token=SECRET#frag")
        assertNotNull(r)
        assertEquals("https://example.com/login", r.sanitizedUrl)
        assertTrue(r.original.contains("SECRET") && r.hadQuery && r.hadFragment && r.hadUserinfo)
    }
}
