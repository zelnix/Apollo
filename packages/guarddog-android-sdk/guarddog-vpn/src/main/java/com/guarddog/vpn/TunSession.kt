package com.guarddog.vpn

import java.io.Closeable
import java.io.IOException

/**
 * Owns the established TUN descriptor + reader thread so recovery is deterministic:
 * close() stops the reader, closes the descriptor exactly once and clears the drop reporter.
 * Unit-testable with any Closeable standing in for the ParcelFileDescriptor.
 */
class TunSession(
    private val descriptor: Closeable,
    private val reader: TunPacketReader,
    private val thread: Thread?,
    private val onClosed: () -> Unit = {},
) : Closeable {
    @Volatile var closed: Boolean = false
        private set

    fun start() { thread?.start() }

    @Synchronized
    override fun close() {
        if (closed) return
        closed = true
        reader.stop()
        try { descriptor.close() } catch (e: IOException) { /* descriptor already gone; nothing to forward anyway */ }
        thread?.interrupt()
        onClosed()
    }
}
