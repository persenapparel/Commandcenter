import AppIntents
import Foundation
import Observation

@MainActor @Observable final class DonnaRouter {
    static let shared = DonnaRouter()
    var route = "talk"
    func open(_ route: String) {
        guard ["talk", "briefing", "teach", "tasks", "inventory", "overview"].contains(route) else { return }
        self.route = route
    }
}

struct OpenDonnaIntent: AppIntent {
    static let title: LocalizedStringResource = "Donna"
    static let description = IntentDescription("Open Donna's voice conversation screen. Tap the microphone to begin.")
    static var supportedModes: IntentModes { .foreground }
    static var authenticationPolicy: IntentAuthenticationPolicy { .requiresLocalDeviceAuthentication }
    @MainActor func perform() async throws -> some IntentResult {
        DonnaRouter.shared.open("talk")
        return .result()
    }
}
struct DonnaBriefingIntent: AppIntent {
    static let title: LocalizedStringResource = "Donna Morning Briefing"
    static var supportedModes: IntentModes { .foreground }
    static var authenticationPolicy: IntentAuthenticationPolicy { .requiresLocalDeviceAuthentication }
    @MainActor func perform() async throws -> some IntentResult {
        DonnaRouter.shared.open("briefing")
        return .result()
    }
}
struct TeachDonnaIntent: AppIntent {
    static let title: LocalizedStringResource = "Teach Donna"
    static var supportedModes: IntentModes { .foreground }
    static var authenticationPolicy: IntentAuthenticationPolicy { .requiresLocalDeviceAuthentication }
    @MainActor func perform() async throws -> some IntentResult {
        DonnaRouter.shared.open("teach")
        return .result()
    }
}
struct DonnaTasksIntent: AppIntent {
    static let title: LocalizedStringResource = "Donna's Tasks"
    static var supportedModes: IntentModes { .foreground }
    static var authenticationPolicy: IntentAuthenticationPolicy { .requiresLocalDeviceAuthentication }
    @MainActor func perform() async throws -> some IntentResult {
        DonnaRouter.shared.open("tasks")
        return .result()
    }
}
struct DonnaInventoryIntent: AppIntent {
    static let title: LocalizedStringResource = "Donna Inventory"
    static var supportedModes: IntentModes { .foreground }
    static var authenticationPolicy: IntentAuthenticationPolicy { .requiresLocalDeviceAuthentication }
    @MainActor func perform() async throws -> some IntentResult {
        DonnaRouter.shared.open("inventory")
        return .result()
    }
}
struct DonnaOverviewIntent: AppIntent {
    static let title: LocalizedStringResource = "Donna Business Overview"
    static var supportedModes: IntentModes { .foreground }
    static var authenticationPolicy: IntentAuthenticationPolicy { .requiresLocalDeviceAuthentication }
    @MainActor func perform() async throws -> some IntentResult {
        DonnaRouter.shared.open("overview")
        return .result()
    }
}
struct DonnaAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: OpenDonnaIntent(), phrases: ["Open \(.applicationName)"],
                    shortTitle: "Donna", systemImageName: "waveform")
        AppShortcut(intent: DonnaBriefingIntent(), phrases: ["\(.applicationName) morning briefing"],
                    shortTitle: "Morning briefing", systemImageName: "sun.max")
        AppShortcut(intent: TeachDonnaIntent(), phrases: ["Teach \(.applicationName)"],
                    shortTitle: "Teach Donna", systemImageName: "book")
        AppShortcut(intent: DonnaTasksIntent(), phrases: ["\(.applicationName)'s tasks"],
                    shortTitle: "Donna's tasks", systemImageName: "checklist")
        AppShortcut(intent: DonnaInventoryIntent(), phrases: ["\(.applicationName) inventory"],
                    shortTitle: "Inventory", systemImageName: "shippingbox")
        AppShortcut(intent: DonnaOverviewIntent(), phrases: ["\(.applicationName) business overview"],
                    shortTitle: "Business overview", systemImageName: "chart.bar")
    }
}
