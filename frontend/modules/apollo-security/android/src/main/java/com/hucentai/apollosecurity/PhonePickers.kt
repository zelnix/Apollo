package com.hucentai.apollosecurity

import android.content.Context
import android.provider.CallLog
import android.provider.Telephony
import org.json.JSONArray
import org.json.JSONObject

/**
 * On-demand readers for the Call Gate (recent callers) and Text Gate (inbox messages) pickers.
 * Both require a sensitive runtime permission the user grants explicitly (READ_CALL_LOG / READ_SMS);
 * when it is not granted the reader returns an empty list rather than throwing. Nothing is retained —
 * the lists are built fresh on each call and handed straight to the picker UI.
 */
object PhonePickers {

  /** Most-recent callers, de-duplicated by number. [{number, name, date, type}] */
  fun recentCallsJson(ctx: Context, limit: Int = 60): String {
    val arr = JSONArray()
    val seen = HashSet<String>()
    try {
      val cols = arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.CACHED_NAME, CallLog.Calls.DATE, CallLog.Calls.TYPE)
      ctx.contentResolver.query(CallLog.Calls.CONTENT_URI, cols, null, null, "${CallLog.Calls.DATE} DESC")?.use { c ->
        val iNum = c.getColumnIndex(CallLog.Calls.NUMBER)
        val iName = c.getColumnIndex(CallLog.Calls.CACHED_NAME)
        val iDate = c.getColumnIndex(CallLog.Calls.DATE)
        val iType = c.getColumnIndex(CallLog.Calls.TYPE)
        while (c.moveToNext() && arr.length() < limit) {
          val number = (if (iNum >= 0) c.getString(iNum) else null)?.trim().orEmpty()
          if (number.isEmpty() || !seen.add(number)) continue
          arr.put(JSONObject()
            .put("number", number)
            .put("name", if (iName >= 0) c.getString(iName) ?: JSONObject.NULL else JSONObject.NULL)
            .put("date", if (iDate >= 0) c.getLong(iDate) else 0L)
            .put("type", callType(if (iType >= 0) c.getInt(iType) else 0)))
        }
      }
    } catch (_: Exception) { /* permission missing or provider unavailable → empty list */ }
    return arr.toString()
  }

  /** Most-recent inbox SMS. [{address, body, date}] */
  fun recentSmsJson(ctx: Context, limit: Int = 60): String {
    val arr = JSONArray()
    try {
      val cols = arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE)
      ctx.contentResolver.query(Telephony.Sms.Inbox.CONTENT_URI, cols, null, null, "${Telephony.Sms.DATE} DESC")?.use { c ->
        val iAddr = c.getColumnIndex(Telephony.Sms.ADDRESS)
        val iBody = c.getColumnIndex(Telephony.Sms.BODY)
        val iDate = c.getColumnIndex(Telephony.Sms.DATE)
        while (c.moveToNext() && arr.length() < limit) {
          val body = (if (iBody >= 0) c.getString(iBody) else null)?.trim().orEmpty()
          if (body.isEmpty()) continue
          arr.put(JSONObject()
            .put("address", if (iAddr >= 0) c.getString(iAddr) ?: "" else "")
            .put("body", body)
            .put("date", if (iDate >= 0) c.getLong(iDate) else 0L))
        }
      }
    } catch (_: Exception) { /* permission missing or provider unavailable → empty list */ }
    return arr.toString()
  }

  private fun callType(type: Int): String = when (type) {
    CallLog.Calls.INCOMING_TYPE -> "incoming"
    CallLog.Calls.OUTGOING_TYPE -> "outgoing"
    CallLog.Calls.MISSED_TYPE -> "missed"
    CallLog.Calls.REJECTED_TYPE -> "rejected"
    CallLog.Calls.BLOCKED_TYPE -> "blocked"
    else -> "other"
  }
}
