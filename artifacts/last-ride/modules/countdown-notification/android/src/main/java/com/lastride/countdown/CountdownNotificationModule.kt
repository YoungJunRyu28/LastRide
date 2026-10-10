package com.lastride.countdown

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** What the ongoing night-tracking notification shows. */
class CountdownContent : Record {
  @Field var title: String = ""
  @Field var body: String = ""
  /** Epoch ms the chronometer counts down to. */
  @Field var countdownTo: Double = 0.0
  /** Second line under the body, e.g. "終電 23:52 半蔵門線 押上行". */
  @Field var detail: String? = null
  /** Deep link opened on tap. */
  @Field var url: String = "last-ride://ride"
  @Field var mapLabel: String? = null
  /** geo: URI for the "map" action. */
  @Field var mapUrl: String? = null
  @Field var stopLabel: String? = null
  /** Deep link for the "stop tracking" action. */
  @Field var stopUrl: String? = null
  @Field var channelName: String = "Night countdown"
}

/**
 * The Android counterpart of the iOS Live Activity: an ongoing notification
 * whose chronometer counts down to leave-by. On Android 16 it asks to be
 * promoted to a Live Update. Premium; lib/liveActivity.ts decides when.
 */
class CountdownNotificationModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val manager: NotificationManager
    get() = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  override fun definition() = ModuleDefinition {
    Name("CountdownNotification")

    Function("show") { content: CountdownContent ->
      ensureChannel(content.channelName)
      manager.notify(NOTIFICATION_ID, build(content))
    }

    Function("dismiss") {
      manager.cancel(NOTIFICATION_ID)
    }
  }

  private fun ensureChannel(name: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    // Low importance: the countdown updates silently; reminders use their own channel.
    val channel = NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_LOW)
    channel.setShowBadge(false)
    manager.createNotificationChannel(channel)
  }

  private fun viewIntent(url: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
      if (url.startsWith("last-ride:")) setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun build(content: CountdownContent): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }
    val text = listOfNotNull(content.body, content.detail).joinToString("\n")
    builder
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(content.title)
      .setContentText(content.body)
      .setStyle(Notification.BigTextStyle().bigText(text))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_NAVIGATION)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setShowWhen(true)
      .setWhen(content.countdownTo.toLong())
      .setUsesChronometer(true)
      .setContentIntent(viewIntent(content.url, 0))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) builder.setChronometerCountDown(true)

    val map = content.mapUrl
    if (map != null && content.mapLabel != null) {
      builder.addAction(Notification.Action.Builder(null, content.mapLabel, viewIntent(map, 1)).build())
    }
    val stop = content.stopUrl
    if (stop != null && content.stopLabel != null) {
      builder.addAction(Notification.Action.Builder(null, content.stopLabel, viewIntent(stop, 2)).build())
    }

    // Android 16 Live Updates: request promotion. The extra is the documented
    // switch; the short critical text is the status-bar chip, set by reflection
    // so older compile SDKs still build.
    builder.extras.putBoolean("android.requestPromotedOngoing", true)
    try {
      builder.javaClass.getMethod("setShortCriticalText", String::class.java).invoke(builder, content.title)
    } catch (_: Exception) {
    }
    return builder.build()
  }

  companion object {
    private const val CHANNEL_ID = "night-countdown"
    private const val NOTIFICATION_ID = 4120
  }
}
