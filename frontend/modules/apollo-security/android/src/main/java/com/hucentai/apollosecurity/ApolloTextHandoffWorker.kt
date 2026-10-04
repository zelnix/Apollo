package com.hucentai.apollosecurity

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** OS-owned network handoff. Backend acknowledgement is required before native queue deletion.
 * B1 fix: now reads the backend response to capture caseId/jobId, stores them in SharedPreferences
 * so the app-side poll loop can check investigation results and deliver warnings/PatrolEvents. */
class ApolloTextHandoffWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
  companion object {
    private const val PREFS = "apollo_text_assessments"
    private const val KEY_PENDING = "pending_assessments"
    private const val MAX_ASSESSMENTS = 30

    fun pendingAssessments(ctx: Context): org.json.JSONArray {
      val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      return try { org.json.JSONArray(prefs.getString(KEY_PENDING, "[]")) } catch (_: Exception) { org.json.JSONArray() }
    }

    fun removePendingAssessment(ctx: Context, caseId: String) {
      val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val arr = pendingAssessments(ctx)
      val kept = org.json.JSONArray()
      for (i in 0 until arr.length()) {
        val item = arr.optJSONObject(i) ?: continue
        if (item.optString("caseId") != caseId) kept.put(item)
      }
      prefs.edit().putString(KEY_PENDING, kept.toString()).apply()
    }

    private fun addPendingAssessment(ctx: Context, caseId: String, sender: String, textPreview: String) {
      val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val arr = pendingAssessments(ctx)
      // Deduplicate by caseId
      for (i in 0 until arr.length()) {
        if (arr.optJSONObject(i)?.optString("caseId") == caseId) return
      }
      arr.put(JSONObject().put("caseId", caseId).put("sender", sender).put("textPreview", textPreview.take(120))
        .put("submittedAt", java.time.Instant.now().toString()))
      // Trim oldest
      while (arr.length() > MAX_ASSESSMENTS) arr.remove(0)
      prefs.edit().putString(KEY_PENDING, arr.toString()).apply()
    }
  }

  override fun doWork(): Result {
    val backend = ApolloSmsListenerService.backendUrl(applicationContext) ?: return Result.failure()
    val token = try { ApolloSmsListenerService.deviceToken(applicationContext) } catch (_: Exception) { return Result.failure() }
      ?: return Result.failure()
    val queue = ApolloSmsListenerService.readQueue(applicationContext)
    for (index in 0 until queue.length()) {
      val item = queue.optJSONObject(index) ?: continue
      if (item.optString("status") != "pending") continue
      val response = try { submit(backend, token, item) } catch (_: Exception) { return Result.retry() }
      if (response.first in 200..299) {
        ApolloSmsListenerService.acknowledge(applicationContext, setOf(item.optString("id")))
        // Store the caseId so the app can poll for the assessment result
        val caseId = response.second?.optString("caseId")
        if (!caseId.isNullOrBlank()) {
          addPendingAssessment(applicationContext, caseId, item.optString("sender", ""), item.optString("text", ""))
        }
      }
      else if (response.first == 401 || response.first == 403 || response.first == 422) return Result.failure()
      else return Result.retry()
    }
    return Result.success()
  }

  private fun submit(backend: String, token: String, item: JSONObject): Pair<Int, JSONObject?> {
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
    val responseBody = try {
      val stream = if (code >= 400) connection.errorStream else connection.inputStream
      val text = stream?.bufferedReader()?.readText()
      stream?.close()
      if (text != null) JSONObject(text) else null
    } catch (_: Exception) { null } finally { connection.disconnect() }
    return Pair(code, responseBody)
  }
}