package com.hucentai.apollosecurity

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.util.Log
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * ApolloDnsVpnService — Site Guard for Android.
 *
 * A local, DNS-only VPN: the tunnel routes *only* the virtual DNS server address
 * (10.111.0.1/32), so ordinary traffic never enters the tunnel (battery/perf).
 * Every DNS query is parsed on-device; queries for hosts Apollo has verified
 * as threats receive NXDOMAIN, everything else is forwarded to the real upstream
 * resolver over a protected socket. No query is logged or sent anywhere else.
 */
class ApolloDnsVpnService : VpnService() {
  companion object {
    const val ACTION_START = "com.hucentai.apollosecurity.START"
    const val ACTION_STOP = "com.hucentai.apollosecurity.STOP"
    private const val TAG = "ApolloDnsVpn"
    private const val PREFS = "apollo_siteguard"
    private const val KEY_BLOCKED = "blocked_hosts"
    private const val VIRTUAL_DNS = "10.111.0.1"
    private const val TUN_ADDRESS = "10.111.0.2"

    @Volatile var isRunning = false
      private set
    @Volatile private var blocked: Set<String> = emptySet()
    @Volatile var lastBlockedAt: Long = 0L
    @Volatile var blockedCount: Long = 0L

    fun loadBlocked(ctx: Context): Set<String> {
      val set = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(KEY_BLOCKED, emptySet()) ?: emptySet()
      blocked = set.map { it.lowercase() }.toSet()
      return blocked
    }
    fun addBlocked(ctx: Context, host: String) {
      val set = loadBlocked(ctx).toMutableSet(); set.add(host.lowercase())
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putStringSet(KEY_BLOCKED, set).apply(); blocked = set
    }
    fun removeBlocked(ctx: Context, host: String) {
      val set = loadBlocked(ctx).toMutableSet(); set.remove(host.lowercase())
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putStringSet(KEY_BLOCKED, set).apply(); blocked = set
    }
    fun isBlockedHost(host: String): Boolean {
      val h = host.lowercase().trimEnd('.')
      return blocked.any { h == it || h.endsWith(".$it") }
    }
  }

  private var tun: ParcelFileDescriptor? = null
  private val alive = AtomicBoolean(false)

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) { stopTunnel(); stopSelf(); return START_NOT_STICKY }
    if (!alive.get()) startTunnel()
    return START_STICKY
  }

  private fun startTunnel() {
    loadBlocked(this)
    val builder = Builder()
      .setSession("Apollo Site Guard")
      .addAddress(TUN_ADDRESS, 32)
      .addDnsServer(VIRTUAL_DNS)
      .addRoute(VIRTUAL_DNS, 32) // DNS-only tunnel
      .setBlocking(true)
    try { builder.addDisallowedApplication(packageName) } catch (_: Exception) {}
    tun = builder.establish() ?: run { Log.w(TAG, "establish() returned null"); return }
    alive.set(true); isRunning = true
    thread(name = "apollo-dns-loop", isDaemon = true) { loop() }
  }

  private fun stopTunnel() {
    alive.set(false); isRunning = false
    try { tun?.close() } catch (_: Exception) {}
    tun = null
  }

  override fun onDestroy() { stopTunnel(); super.onDestroy() }
  override fun onRevoke() { stopTunnel(); super.onRevoke() }

  private fun upstreamDns(): InetAddress {
    try {
      val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val lp = cm.getLinkProperties(cm.activeNetwork)
      lp?.dnsServers?.firstOrNull { it.address.size == 4 && it.hostAddress != VIRTUAL_DNS }?.let { return it }
    } catch (_: Exception) {}
    return InetAddress.getByAddress(byteArrayOf(1, 1, 1, 1))
  }

  private fun loop() {
    val fd = tun ?: return
    val input = FileInputStream(fd.fileDescriptor)
    val output = FileOutputStream(fd.fileDescriptor)
    val buf = ByteArray(32767)
    while (alive.get()) {
      val n = try { input.read(buf) } catch (_: Exception) { -1 }
      if (n <= 0) { if (n < 0) break else continue }
      val packet = buf.copyOf(n)
      try { handlePacket(packet, output) } catch (e: Exception) { Log.d(TAG, "packet error: ${e.javaClass.simpleName}") }
    }
  }

  /** IPv4 + UDP + DNS only; anything else is dropped (the tunnel only routes the virtual DNS IP anyway). */
  private fun handlePacket(pkt: ByteArray, out: FileOutputStream) {
    if (pkt.size < 28 || (pkt[0].toInt() shr 4) != 4 || pkt[9].toInt() != 17) return
    val ihl = (pkt[0].toInt() and 0x0F) * 4
    val udpStart = ihl
    val dstPort = ((pkt[udpStart + 2].toInt() and 0xFF) shl 8) or (pkt[udpStart + 3].toInt() and 0xFF)
    if (dstPort != 53) return
    val dnsStart = udpStart + 8
    val dns = pkt.copyOfRange(dnsStart, pkt.size)
    val qname = parseQName(dns) ?: return

    val response: ByteArray = if (isBlockedHost(qname)) {
      blockedCount++; lastBlockedAt = System.currentTimeMillis()
      nxdomain(dns)
    } else {
      forward(dns) ?: return
    }
    out.write(wrapReply(pkt, ihl, response))
  }

  private fun parseQName(dns: ByteArray): String? {
    if (dns.size < 12) return null
    var i = 12; val sb = StringBuilder()
    while (i < dns.size) {
      val len = dns[i].toInt() and 0xFF
      if (len == 0) break
      if (len >= 0xC0 || i + 1 + len > dns.size) return null
      if (sb.isNotEmpty()) sb.append('.')
      sb.append(String(dns, i + 1, len, Charsets.US_ASCII)); i += 1 + len
    }
    return sb.toString().ifEmpty { null }
  }

  /** Copy the question, set QR=1, RA=1, RCODE=3 (NXDOMAIN), zero answer counts. */
  private fun nxdomain(query: ByteArray): ByteArray {
    val r = query.copyOf()
    r[2] = (r[2].toInt() or 0x80).toByte()          // QR
    r[3] = ((r[3].toInt() and 0x70) or 0x80 or 0x03).toByte() // RA + RCODE 3
    r[6] = 0; r[7] = 0; r[8] = 0; r[9] = 0; r[10] = 0; r[11] = 0
    return r
  }

  private fun forward(query: ByteArray): ByteArray? {
    val socket = DatagramSocket()
    try {
      protect(socket)
      socket.soTimeout = 2500
      socket.send(DatagramPacket(query, query.size, InetSocketAddress(upstreamDns(), 53)))
      val reply = ByteArray(4096); val dp = DatagramPacket(reply, reply.size)
      socket.receive(dp)
      return reply.copyOf(dp.length)
    } catch (_: Exception) { return null } finally { socket.close() }
  }

  /** Build an IPv4/UDP reply by swapping addresses and ports of the request. */
  private fun wrapReply(req: ByteArray, ihl: Int, payload: ByteArray): ByteArray {
    val total = 20 + 8 + payload.size
    val b = ByteBuffer.allocate(total)
    b.put((0x45).toByte()); b.put(0); b.putShort(total.toShort()); b.putShort(0); b.putShort(0x4000.toShort()); b.put(64); b.put(17); b.putShort(0)
    b.put(req, 16, 4) // src = original dst
    b.put(req, 12, 4) // dst = original src
    val srcPort = ((req[ihl].toInt() and 0xFF) shl 8) or (req[ihl + 1].toInt() and 0xFF)
    b.putShort(53); b.putShort(srcPort.toShort()); b.putShort((8 + payload.size).toShort()); b.putShort(0) // UDP checksum 0 = none (IPv4)
    b.put(payload)
    val arr = b.array()
    val cs = ipChecksum(arr, 0, 20); arr[10] = (cs shr 8).toByte(); arr[11] = cs.toByte()
    return arr
  }

  private fun ipChecksum(data: ByteArray, off: Int, len: Int): Int {
    var sum = 0L; var i = off
    while (i < off + len - 1) { sum += ((data[i].toInt() and 0xFF) shl 8) or (data[i + 1].toInt() and 0xFF); i += 2 }
    while (sum shr 16 != 0L) sum = (sum and 0xFFFF) + (sum shr 16)
    return (sum.inv() and 0xFFFF).toInt()
  }
}
