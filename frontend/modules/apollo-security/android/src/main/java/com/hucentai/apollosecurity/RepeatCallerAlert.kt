package com.hucentai.apollosecurity

/**
 * Repeat Caller Alert — whether an incoming call is from a number the person should hear about again, and the
 * words of that alert. Decided only from this device's own lists: the person's block list, and the numbers Apollo
 * found high-risk or worth checking (with when). Pure — no Android types — so it is unit-tested on the JVM.
 *
 *  - On the block list: every call, for as long as the number is on the list.
 *  - Found high-risk (so on the auto-reject list), or found worth checking: every call within 30 days of that finding.
 * Nothing else alerts. The alert never changes the screening decision; it is raised after Android has its answer.
 */
object RepeatCallerAlert {
  const val WINDOW_MS = 30L * 24 * 60 * 60 * 1000
  const val LEVEL_HIGH_RISK = "high_risk"
  const val LEVEL_WORTH_CHECKING = "worth_checking"
  private const val MAX_MARKS = 300

  enum class Reason(val wire: String) { BLOCK_LIST("block_list"), HIGH_RISK("high_risk"), WORTH_CHECKING("worth_checking") }

  /** What Apollo found about a number, and when (epoch ms). */
  data class Mark(val level: String, val atMs: Long)

  data class Alert(val reason: Reason, val title: String, val body: String)

  fun isRecent(mark: Mark?, nowMs: Long): Boolean = mark != null && mark.atMs <= nowMs && nowMs - mark.atMs <= WINDOW_MS

  /** Why this call should raise an alert, or null. Allow-listed calls never get here. */
  fun reasonFor(onBlockList: Boolean, onAutoRejectList: Boolean, mark: Mark?, nowMs: Long): Reason? = when {
    onBlockList -> Reason.BLOCK_LIST
    mark == null || !isRecent(mark, nowMs) -> null
    onAutoRejectList -> Reason.HIGH_RISK
    mark.level == LEVEL_WORTH_CHECKING -> Reason.WORTH_CHECKING
    else -> null
  }

  /** [foundOn] is the finding's date as the person reads it. */
  fun alertFor(reason: Reason, number: String, foundOn: String?): Alert {
    val on = foundOn?.let { " on $it" } ?: ""
    return when (reason) {
      Reason.BLOCK_LIST -> Alert(reason, "ApolloSG: a number you blocked called again",
        "$number is on your block list. ApolloSG asked Android to reject the call. Tap to see what Apollo found before.")
      Reason.HIGH_RISK -> Alert(reason, "ApolloSG: a high-risk number called again",
        "Apollo found $number high-risk$on. ApolloSG asked Android to reject the call. Tap to see what Apollo found before.")
      Reason.WORTH_CHECKING -> Alert(reason, "ApolloSG: a number worth checking is calling",
        "Apollo found $number worth checking$on. Don't give out codes, passwords or money. Tap to check it again.")
    }
  }

  /** A high-risk finding, dated now. */
  fun withHighRisk(marks: Map<String, Mark>, number: String, nowMs: Long): Map<String, Mark> =
    marks + (number to Mark(LEVEL_HIGH_RISK, nowMs))

  /** A worth-checking finding (on), or a later clean result clearing it (off). Never lowers a number Apollo still
   *  rejects as high-risk, and a clean result never clears a high-risk finding. */
  fun withWorthChecking(marks: Map<String, Mark>, number: String, on: Boolean, onAutoRejectList: Boolean, nowMs: Long): Map<String, Mark> = when {
    on && !onAutoRejectList -> marks + (number to Mark(LEVEL_WORTH_CHECKING, nowMs))
    !on && marks[number]?.level == LEVEL_WORTH_CHECKING -> marks - number
    else -> marks
  }

  /** Only findings inside the window, newest [MAX_MARKS] at most. */
  fun prune(marks: Map<String, Mark>, nowMs: Long): Map<String, Mark> =
    marks.filterValues { isRecent(it, nowMs) }.entries.sortedByDescending { it.value.atMs }.take(MAX_MARKS).associate { it.key to it.value }
}
