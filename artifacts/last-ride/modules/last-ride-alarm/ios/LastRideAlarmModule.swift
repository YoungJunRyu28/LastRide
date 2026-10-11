import ExpoModulesCore
import AlarmKit
import ActivityKit
import SwiftUI

@available(iOS 26.0, *)
private struct LastRideAlarmMetadata: AlarmMetadata {}

public class LastRideAlarmModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LastRideAlarm")

    AsyncFunction("authorizationStatus") { () -> String in
      guard #available(iOS 26.0, *) else { return "unsupported" }
      switch AlarmManager.shared.authorizationState {
      case .authorized: return "authorized"
      case .denied: return "denied"
      case .notDetermined: return "notDetermined"
      @unknown default: return "denied"
      }
    }

    AsyncFunction("requestAuthorization") { () async throws -> String in
      guard #available(iOS 26.0, *) else { return "unsupported" }
      let state = try await AlarmManager.shared.requestAuthorization()
      return state == .authorized ? "authorized" : "denied"
    }

    AsyncFunction("scheduleAlarm") { (id: String, fireAtMs: Double, title: String, soundName: String) async throws -> Void in
      guard #available(iOS 26.0, *) else {
        throw Exception(name: "ALARM_UNSUPPORTED", description: "AlarmKit needs iOS 26 or later.")
      }
      guard AlarmManager.shared.authorizationState == .authorized else {
        throw Exception(name: "ALARM_NOT_AUTHORIZED", description: "User has not authorized alarms.")
      }
      guard let uuid = UUID(uuidString: id), fireAtMs.isFinite, fireAtMs > Date().timeIntervalSince1970 * 1000 else {
        throw Exception(name: "INVALID_ALARM", description: "Expected a unique UUID and a future time.")
      }
      let stop = AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.circle.fill")
      let alert = AlarmPresentation.Alert(title: LocalizedStringResource(stringLiteral: title), stopButton: stop)
      let attributes = AlarmAttributes<LastRideAlarmMetadata>(
        presentation: AlarmPresentation(alert: alert),
        metadata: LastRideAlarmMetadata(),
        tintColor: .orange
      )
      let alertSound: AlertConfiguration.AlertSound
      switch soundName {
      case "pulse": alertSound = .named("lastride_pulse.caf")
      case "chime": alertSound = .named("lastride_chime.caf")
      case "urgent": alertSound = .named("lastride_urgent.caf")
      default: alertSound = .default
      }
      let config = AlarmManager.AlarmConfiguration<LastRideAlarmMetadata>.alarm(
        schedule: .fixed(Date(timeIntervalSince1970: fireAtMs / 1000)),
        attributes: attributes,
        sound: alertSound
      )
      _ = try await AlarmManager.shared.schedule(id: uuid, configuration: config)
    }

    AsyncFunction("cancelAll") { () throws -> Void in
      guard #available(iOS 26.0, *) else { return }
      for alarm in try AlarmManager.shared.alarms {
        try? AlarmManager.shared.cancel(id: alarm.id)
      }
    }
  }
}
