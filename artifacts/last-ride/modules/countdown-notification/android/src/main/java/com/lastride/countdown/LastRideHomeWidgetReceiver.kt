package com.lastride.countdown

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * Android home-screen counterpart of LeaveWidget (iOS WidgetKit).
 * The app sends the same computed timeline; the launcher never fetches routes,
 * requests location, or interprets a cached time as live transit data.
 */
class LastRideHomeWidgetReceiver : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    super.onUpdate(context, manager, ids)
    refresh(context)
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    if (intent.action == ACTION_REFRESH) refresh(context)
  }

  override fun onDisabled(context: Context) {
    super.onDisabled(context)
    context.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().remove(KEY).apply()
    alarm(context).cancel(refreshIntent(context))
  }

  companion object {
    private const val PREF = "lastride_android_widget"
    private const val KEY = "timeline"
    private const val ACTION_REFRESH = "jp.lastride.app.WIDGET_REFRESH"
    private const val MAX_PAYLOAD = 32_000

    /** Private device-local data only: no capability secrets or raw GPS coords. */
    fun save(context: Context, json: String) {
      if (json.length > MAX_PAYLOAD) return
      JSONObject(json) // Reject a malformed update without destroying the last good one.
      context.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
      refresh(context)
    }

    private fun alarm(context: Context): AlarmManager =
      context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    private fun refreshIntent(context: Context): PendingIntent =
      PendingIntent.getBroadcast(
        context, 4121,
        Intent(context, LastRideHomeWidgetReceiver::class.java).setAction(ACTION_REFRESH),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

    private fun openIntent(context: Context, url: String): PendingIntent {
      // Never open arbitrary external intents from stale/malformed widget data.
      val safeUrl = if (url.startsWith("last-ride://ride") ||
        url.startsWith("last-ride://paywall") ||
        url.startsWith("last-ride://alternatives")) url else "last-ride://ride"
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(safeUrl)).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      return PendingIntent.getActivity(
        context, 4122, intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    private fun color(value: String?, fallback: Int): Int =
      try { Color.parseColor(value ?: "") } catch (_: Exception) { fallback }

    fun refresh(context: Context) {
      val widgetManager = AppWidgetManager.getInstance(context)
      val ids = widgetManager.getAppWidgetIds(ComponentName(context, LastRideHomeWidgetReceiver::class.java))
      val pending = refreshIntent(context)
      alarm(context).cancel(pending)
      if (ids.isEmpty()) return

      val now = System.currentTimeMillis()
      var nextUpdate = Long.MAX_VALUE
      var chosen: JSONObject? = null
      var isStale = true
      var staleMessage = "Open LastRide to check"
      var openLabel = "Tap to refresh"
      try {
        val raw = context.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString(KEY, null)
        val snapshot = JSONObject(raw ?: "{}")
        staleMessage = snapshot.optString("staleMessage").ifBlank { staleMessage }
        openLabel = snapshot.optString("openLabel").ifBlank { openLabel }
        val expiresAt = snapshot.optLong("expiresAt", 0L)
        isStale = expiresAt <= now
        if (!isStale) nextUpdate = expiresAt
        val entries = snapshot.optJSONArray("entries")
        if (entries != null) {
          for (i in 0 until entries.length()) {
            val entry = entries.optJSONObject(i) ?: continue
            val at = entry.optLong("at", -1L)
            if (at <= now) chosen = entry
            else if (at < nextUpdate) nextUpdate = at
          }
        }
      } catch (_: Exception) {
        // Corrupt data is not a reason to show a possibly wrong last train.
      }

      val views = RemoteViews(context.packageName, R.layout.last_ride_home_widget)
      val primary = if (!isStale && chosen != null) chosen.optString("primary") else staleMessage
      val heading = if (!isStale && chosen != null) chosen.optString("heading") else "LastRide"
      val secondary = if (!isStale && chosen != null) chosen.optString("secondary") else openLabel
      val footer = if (!isStale && chosen != null) {
        chosen.optString("footer").let { if (it.isBlank()) openLabel else "$it · $openLabel" }
      } else ""
      views.setTextViewText(R.id.last_ride_widget_heading, heading)
      views.setTextViewText(R.id.last_ride_widget_primary, primary)
      views.setTextViewText(R.id.last_ride_widget_secondary, secondary)
      views.setTextViewText(R.id.last_ride_widget_footer, footer)
      val background = color(chosen?.optString("background"), Color.rgb(10, 19, 34))
      val foreground = color(chosen?.optString("foreground"), Color.WHITE)
      val accent = color(chosen?.optString("accent"), Color.rgb(245, 169, 59))
      val muted = color(chosen?.optString("muted"), Color.LTGRAY)
      views.setInt(R.id.last_ride_widget_root, "setBackgroundColor", background)
      views.setTextColor(R.id.last_ride_widget_heading, muted)
      views.setTextColor(R.id.last_ride_widget_primary, if (isStale) accent else foreground)
      views.setTextColor(R.id.last_ride_widget_secondary, accent)
      views.setTextColor(R.id.last_ride_widget_footer, muted)
      views.setOnClickPendingIntent(
        R.id.last_ride_widget_root,
        openIntent(context, if (!isStale && chosen != null) chosen.optString("url") else "last-ride://ride"),
      )
      ids.forEach { widgetManager.updateAppWidget(it, views) }

      // Best-effort inexact transition: Doze can delay it. Every card always
      // shows when the plan was last checked and prompts opening the app.
      if (nextUpdate != Long.MAX_VALUE && nextUpdate > now) {
        val time = nextUpdate.coerceAtLeast(now + 1000L)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          alarm(context).setAndAllowWhileIdle(AlarmManager.RTC, time, pending)
        } else {
          alarm(context).set(AlarmManager.RTC, time, pending)
        }
      }
    }
  }
}
