package com.guarddog.vpn

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DnsQueryParserTest {
    private fun u16(v: Int) = byteArrayOf(((v ushr 8) and 0xff).toByte(), (v and 0xff).toByte())

    private fun buildQuery(
        qname: String,
        qtype: Int = DnsQueryParser.TYPE_A,
        qclass: Int = DnsQueryParser.CLASS_IN,
        transactionId: Int = 0x1234,
        flags: Int = 0x0100, // QR=0, opcode=0, RD=1
        qdcount: Int = 1,
        usePointer: Boolean = false,
    ): ByteArray {
        val out = ArrayList<Byte>()
        out.addAll(u16(transactionId).toList())
        out.addAll(u16(flags).toList())
        out.addAll(u16(qdcount).toList())
        out.addAll(u16(0).toList())
        out.addAll(u16(0).toList())
        out.addAll(u16(0).toList())
        if (usePointer) {
            out.add(0xC0.toByte()); out.add(0x0C)
        } else {
            for (label in qname.split('.')) {
                out.add(label.length.toByte())
                out.addAll(label.toByteArray(Charsets.US_ASCII).toList())
            }
            out.add(0)
        }
        out.addAll(u16(qtype).toList())
        out.addAll(u16(qclass).toList())
        return out.toByteArray()
    }

    @Test fun parsesSimpleAQuery() {
        val msg = buildQuery("bad-test.guarddog.example")
        val q = DnsQueryParser.parse(msg, 0, msg.size)!!
        assertEquals(0x1234, q.transactionId)
        assertEquals("bad-test.guarddog.example", q.qname)
        assertEquals(DnsQueryParser.TYPE_A, q.qtype)
        assertEquals(DnsQueryParser.CLASS_IN, q.qclass)
    }

    @Test fun parsesAaaaQuery() {
        val msg = buildQuery("bad-test.guarddog.example", qtype = DnsQueryParser.TYPE_AAAA)
        val q = DnsQueryParser.parse(msg, 0, msg.size)!!
        assertEquals(DnsQueryParser.TYPE_AAAA, q.qtype)
    }

    @Test fun rejectsResponses() {
        val msg = buildQuery("bad-test.guarddog.example", flags = 0x8180) // QR=1
        assertNull(DnsQueryParser.parse(msg, 0, msg.size))
    }

    @Test fun rejectsMultiQuestion() {
        val msg = buildQuery("bad-test.guarddog.example", qdcount = 2)
        assertNull(DnsQueryParser.parse(msg, 0, msg.size))
    }

    @Test fun rejectsCompressionPointerInQuestionName() {
        val msg = buildQuery("bad-test.guarddog.example", usePointer = true)
        assertNull(DnsQueryParser.parse(msg, 0, msg.size))
    }

    @Test fun rejectsUnsupportedQtype() {
        val msg = buildQuery("bad-test.guarddog.example", qtype = 15) // MX
        assertNull(DnsQueryParser.parse(msg, 0, msg.size))
    }

    @Test fun rejectsUnsupportedQclass() {
        val msg = buildQuery("bad-test.guarddog.example", qclass = 3) // CHAOS
        assertNull(DnsQueryParser.parse(msg, 0, msg.size))
    }

    @Test fun rejectsTruncatedMessage() {
        val msg = buildQuery("bad-test.guarddog.example")
        assertNull(DnsQueryParser.parse(msg, 0, 10))
    }

    @Test fun respectsOffsetWithinLargerBuffer() {
        val prefix = ByteArray(20) // simulate an IPv4+UDP header before the DNS payload
        val msg = buildQuery("offset-test.guarddog.example")
        val combined = prefix + msg
        val q = DnsQueryParser.parse(combined, 20, msg.size)!!
        assertEquals("offset-test.guarddog.example", q.qname)
    }
}
