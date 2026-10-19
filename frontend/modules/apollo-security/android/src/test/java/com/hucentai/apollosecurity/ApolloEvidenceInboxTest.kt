package com.hucentai.apollosecurity

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private class MemoryEvidencePersistence(var failSave: Boolean = false) : EvidencePersistence {
  var records = emptyList<String>(); var overflow = 0
  override fun load() = records
  override fun save(records: List<String>): Boolean { if (failSave) return false; this.records = records; return true }
  override fun loadOverflow() = overflow
  override fun saveOverflow(value: Int): Boolean { if (failSave) return false; overflow = value; return true }
}

class ApolloEvidenceInboxTest {
  @Test fun inboxIsBoundedAndReportsOverflowWithoutEvictingPending() {
    val store = MemoryEvidencePersistence(); val inbox = BoundedEvidenceInbox(2, store) { it.substringBefore(':') }
    assertTrue(inbox.append("one:value")); assertTrue(inbox.append("two:value")); assertFalse(inbox.append("three:value"))
    assertEquals(listOf("one:value", "two:value"), inbox.records()); assertEquals(1, inbox.status().overflow)
    assertTrue(inbox.status().error!!.contains("full"))
  }

  @Test fun storageFailureIsExposedWithoutThrowing() {
    val store = MemoryEvidencePersistence(failSave = true); val inbox = BoundedEvidenceInbox(2, store) { it.substringBefore(':') }
    assertFalse(inbox.append("one:value")); assertEquals(0, inbox.status().pending)
    assertTrue(inbox.status().error!!.contains("persistence failed"))
  }
}