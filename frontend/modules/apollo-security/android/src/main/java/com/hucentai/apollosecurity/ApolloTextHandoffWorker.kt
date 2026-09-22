package com.hucentai.apollosecurity

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** OS-owned network handoff. Backend acknowledgement is required before native queue deletion. */
class ApolloTextHandoffWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
  override fun doWork(): Result {
    val backend = ApolloSmsListenerService.backendUrl(applicationContext) ?: return Result.failure()
    val token = try { ApolloSmsListenerService.deviceToken(applicationContext) } catch (_: Exception) { return Result.failure() }
      ?: return Result.failure()
    val queue = ApolloSmsListenerService.readQueue(applicationContext)
    for (index in 0 until queue.length()) {
      val item = queue.optJSONObject(index) ?: continue
      if (item.optString("status") != "pending") continue
      val code = try { submit(backend, token, item) } catch (_: Exception) { return Result.retry() }
      if (code in 200..299) ApolloSmsListenerService.acknowledge(applicationContext, setOf(item.optString("id")))
      else if (code == 401 || code == 403 || code == 422) return Result.failure()
      else return Result.retry()
    }
    return Result.success()
  }

  private fun submit(backend: String, token: String, item: JSONObject): Int {
    val body = JSONObject().put("submissionId", item.getString("id")).put("sourceKey", item.getString("sourceKey"))
      .put("revisionDigest", item.getString("revisionDigest")).put("sender", item.optString("sender"))
      .put("text", item.getString("text")).put("capturedAt", item.getString("capturedAt"))
      .put("expiresAt", item.getString("expiresAt")).put("contentComplete", item.optBoolean("contentComplete", true))
      .put("originalCharacters", item.optInt("originalCharacters", item.getString("text").length))
    val connection = URL("$backend/investigations/background/text").openConnection() as HttpURLConnection
    connection.requestMethod = "POST"; connection.connectTimeout = 20_000; connection.readTimeout = 60_000
    connection.setRequestProperty("Authorization", "Bearer $token"); connection.setRequestProperty("Content-Type", "application/json")
    connection.doOutput = true; connection.outputStream.use { it.write(body.toString().toByteArray()) }
    val code = connection.responseCode
    try { (if (code >= 400) connection.errorStream else connection.inputStream)?.close() } finally { connection.disconnect() }
    return code
  }
}