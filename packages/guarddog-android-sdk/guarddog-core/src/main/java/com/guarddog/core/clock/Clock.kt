package com.guarddog.core.clock

/** Injected clock so verification/dedupe tests run against a frozen time. */
fun interface Clock {
    fun nowEpochMillis(): Long
}

object SystemClock : Clock {
    override fun nowEpochMillis(): Long = System.currentTimeMillis()
}

class FixedClock(@Volatile var millis: Long) : Clock {
    override fun nowEpochMillis(): Long = millis
    fun advance(byMillis: Long) { millis += byMillis }
}
