import SwiftUI
import LocalAuthentication
import AVFoundation
import UIKit

/// Main-actor authorization gate shared by UI and read-only tools.
@MainActor enum NativeAccess {
    static var isUnlocked = false
    static var generation = 0
}

/// Opaque UIKit views are installed before scene deactivation snapshots.
/// This is a defense in addition to the SwiftUI locked view, not a claim that device QA passed.
@MainActor final class PrivacyCurtain {
    static let shared = PrivacyCurtain()
    private var covers: [UIView] = []
    func show() {
        guard covers.isEmpty else { return }
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            for window in scene.windows {
                let cover = UIView(frame: window.bounds)
                cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                cover.backgroundColor = .systemBackground
                cover.isUserInteractionEnabled = true
                let label = UILabel(frame: cover.bounds)
                label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                label.text = "Donna is locked"
                label.textColor = .secondaryLabel
                label.textAlignment = .center
                label.font = .preferredFont(forTextStyle: .headline)
                cover.addSubview(label)
                window.addSubview(cover)
                covers.append(cover)
            }
        }
    }
    func hide() { covers.forEach { $0.removeFromSuperview() }; covers.removeAll() }
}

@main struct DonnaApp: App {
    var body: some Scene { WindowGroup { DonnaView() } }
}

struct DonnaView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var model = DonnaModel()
    @State private var voice = VoiceController()
    @State private var router = DonnaRouter.shared
    @State private var unlocked = false
    @State private var authenticating = false
    @State private var pendingAuthentication = false
    @State private var authenticationGeneration = 0
    @State private var greeted = false
    @State private var settings = false
    @State private var input = ""
    @State private var records = "Tap Load records to read current authenticated data."
    @State private var loadingRecords = false
    @State private var workGeneration = 0
    @State private var responseTask: Task<Void, Never>?
    @State private var recordsTask: Task<Void, Never>?
    @AppStorage("backendURL") private var backendURL = ""
    @AppStorage("allowBusinessReads") private var allowReads = false
    @AppStorage("speakReplies") private var speakReplies = false
    @AppStorage("voiceID") private var voiceID = ""

    var body: some View {
        NavigationStack {
            Group {
                if unlocked { content }
                else {
                    ContentUnavailableView {
                        Label("Donna is locked", systemImage: "lock.shield")
                    } description: {
                        Text("Unlock this iPhone to view private business information.")
                    } actions: {
                        Button("Unlock Donna") { Task { await unlock() } }
                            .disabled(authenticating)
                    }
                }
            }
            .navigationTitle("Donna")
            .toolbar {
                if unlocked {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Settings", systemImage: "gearshape") { settings = true }
                    }
                    ToolbarItem(placement: .topBarLeading) {
                        Menu {
                            Button("Talk to Donna") { router.open("talk") }
                            Button("Morning briefing") { router.open("briefing") }
                            Button("Teach Donna") { router.open("teach") }
                            Button("Today's priorities") { router.open("tasks") }
                            Button("Inventory") { router.open("inventory") }
                            Button("Business overview") { router.open("overview") }
                        } label: { Image(systemName: "line.3.horizontal") }
                    }
                }
            }
            .sheet(isPresented: $settings) { DonnaSettings(model: model, voice: voice) }
        }
        .tint(Color(red: 0.31, green: 0.29, blue: 0.65))
        .task { _ = model.checkAvailability(); await unlock() }
        .onReceive(NotificationCenter.default.publisher(for: UIScene.willDeactivateNotification)) { _ in
            PrivacyCurtain.shared.show()
            lockPrivateData()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)) { _ in
            PrivacyCurtain.shared.show()
            lockPrivateData()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                PrivacyCurtain.shared.show()
                lockPrivateData()
                if phase == .background {
                    authenticationGeneration += 1
                    pendingAuthentication = false
                }
            } else {
                Task {
                    // Allow the locked SwiftUI surface to render before removing UIKit covers.
                    await Task.yield()
                    PrivacyCurtain.shared.hide()
                    if pendingAuthentication { finishUnlock() }
                    else { await unlock() }
                }
            }
        }
        .onChange(of: voice.transcript) { _, text in input = text }
        .onChange(of: router.route) { _, _ in
            voice.silence()
            responseTask?.cancel()
            recordsTask?.cancel()
            model.reset()
            workGeneration += 1
            loadingRecords = false
            records = "Tap Load records to read current authenticated data."
        }
        .onOpenURL { url in
            guard url.scheme == "donna", let route = url.host else { return }
            router.open(route)
        }
    }

    private var content: some View {
        VStack(spacing: 16) {
            HStack {
                Image(systemName: "sparkles").foregroundStyle(.purple)
                Text("Your Persen Apparel Business Assistant").font(.subheadline)
            }
            .padding(.horizontal)
            if router.route == "talk" { conversation }
            else if router.route == "teach" {
                ContentUnavailableView {
                    Label("Teach Donna", systemImage: "book.closed")
                } description: {
                    Text("Review and approve procedures in the web teaching workspace. This saves business knowledge; it does not retrain Apple's model.")
                } actions: { webLink("Open Teach Donna", route: "teach") }
            } else { recordsView }
        }
    }

    private var conversation: some View {
        VStack(spacing: 12) {
            Text(model.modelStatus).font(.caption).foregroundStyle(.secondary)
                .padding(.horizontal).accessibilityLabel(model.modelStatus)
            ScrollViewReader { scroll in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        if model.messages.isEmpty {
                            Text("Hey! What can I help you with today?")
                                .font(.largeTitle.weight(.medium)).padding(.vertical, 30)
                            Text("Talk through an idea, plan your next steps, or check current business records after signing in.")
                                .foregroundStyle(.secondary)
                        }
                        ForEach(model.messages) { message in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(message.owner ? "You" : "Donna").font(.caption.bold()).foregroundStyle(.secondary)
                                Text(message.text).textSelection(.enabled)
                            }
                            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                            .background(message.owner ? Color.purple.opacity(0.08) : Color.secondary.opacity(0.07))
                            .clipShape(RoundedRectangle(cornerRadius: 18)).id(message.id)
                        }
                        if model.isBusy { ProgressView("Thinking on this iPhone…") }
                    }.padding(.horizontal)
                }
                .onChange(of: model.messages.count) { _, _ in
                    if let last = model.messages.last { scroll.scrollTo(last.id, anchor: .bottom) }
                }
            }
            if !voice.issue.isEmpty { Text(voice.issue).font(.caption).foregroundStyle(.red).padding(.horizontal) }
            HStack(alignment: .bottom, spacing: 12) {
                Button {
                    Task { await voice.start() }
                } label: {
                    Image(systemName: voice.isRecording ? "stop.fill" : "mic.fill")
                        .font(.title2).frame(width: 54, height: 54)
                        .background(voice.isRecording ? Color.red : Color.purple).foregroundStyle(.white)
                        .clipShape(Circle())
                }
                .accessibilityLabel(voice.isRecording ? "Stop listening" : "Talk to Donna")
                .disabled(model.isBusy || voice.isStarting)
                TextField("Message Donna…", text: $input, axis: .vertical)
                    .lineLimit(1...5).padding(12).background(.thinMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                Button("Send", systemImage: "arrow.up.circle.fill") { send() }
                    .labelStyle(.iconOnly).font(.largeTitle)
                    .disabled(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isBusy || voice.isRecording)
            }.padding(.horizontal)
            Text(voice.isRecording ? "Listening on this iPhone · tap Stop, review, then Send" : "Push to talk · no background listener · no paid AI")
                .font(.caption2).foregroundStyle(.secondary)
        }.padding(.bottom)
    }

    private var recordsView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(routeTitle).font(.title.bold())
                Text("Authenticated read-only records. Loading never changes orders, payments or inventory. Samples may be bounded; they are not financial totals.")
                    .font(.subheadline).foregroundStyle(.secondary)
                Button(loadingRecords ? "Loading…" : "Load records") {
                    recordsTask = Task { await loadRecords() }
                }
                    .buttonStyle(.borderedProminent).disabled(loadingRecords)
                Text(records).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                if router.route == "overview" {
                    webLink("Open deterministic Pricing assistant", route: "pricing")
                }
            }.padding()
        }
    }

    private var routeTitle: String {
        switch router.route {
        case "briefing": "Morning briefing"
        case "tasks": "Today's priorities"
        case "inventory": "Inventory"
        default: "Business overview"
        }
    }

    @ViewBuilder private func webLink(_ title: String, route: String) -> some View {
        if let base = URL(string: backendURL), base.scheme == "https", base.host != nil,
           base.user == nil, base.password == nil {
            let url = base.appending(path: "donna/").appending(queryItems: [URLQueryItem(name: "view", value: route)])
            Link(title, destination: url).buttonStyle(.borderedProminent)
        } else { Text("Configure your staging HTTPS origin in Settings first.").font(.caption) }
    }

    private func send() {
        let text = input
        let generation = workGeneration
        input = ""
        voice.silence()
        responseTask?.cancel()
        responseTask = Task {
            let reply = await model.send(text, backendURL: backendURL, allowReads: allowReads)
            guard !Task.isCancelled, generation == workGeneration,
                  unlocked, scenePhase == .active else { return }
            if speakReplies, let reply { voice.speak(reply, voiceID: voiceID) }
        }
    }

    private func loadRecords() async {
        guard unlocked, scenePhase == .active else { return }
        let generation = workGeneration
        let requestedRoute = router.route
        loadingRecords = true
        defer { if generation == workGeneration { loadingRecords = false } }
        let tool = router.route == "inventory" ? "inventory" : router.route == "overview" ? "invoices" : "tasks"
        do {
            let result = try await BackendClient.shared.read(tool, backendURL: backendURL)
            guard !Task.isCancelled, generation == workGeneration, requestedRoute == router.route,
                  unlocked, scenePhase == .active else { return }
            records = result
        } catch {
            guard !Task.isCancelled, generation == workGeneration,
                  unlocked, scenePhase == .active else { return }
            records = error.localizedDescription
        }
    }

    private func lockPrivateData() {
        NativeAccess.isUnlocked = false
        NativeAccess.generation += 1
        unlocked = false
        responseTask?.cancel()
        recordsTask?.cancel()
        responseTask = nil
        recordsTask = nil
        workGeneration += 1
        model.reset()
        voice.clear()
        input = ""
        loadingRecords = false
        settings = false
        records = "Tap Load records to read current authenticated data."
    }

    private func unlock() async {
        guard !unlocked, !authenticating, scenePhase == .active else { return }
        authenticating = true
        let generation = authenticationGeneration
        defer { authenticating = false }
        let context = LAContext()
        do {
            let accepted = try await context.evaluatePolicy(.deviceOwnerAuthentication,
                localizedReason: "View your private Donna business assistant")
            guard accepted, generation == authenticationGeneration,
                  scenePhase != .background else {
                unlocked = false
                NativeAccess.isUnlocked = false
                return
            }
            // LocalAuthentication can finish just before the scene reports active.
            pendingAuthentication = true
            finishUnlock()
        } catch { unlocked = false; NativeAccess.isUnlocked = false }
    }

    private func finishUnlock() {
        guard pendingAuthentication, scenePhase == .active,
              UIApplication.shared.applicationState == .active else { return }
        pendingAuthentication = false
        unlocked = true
        NativeAccess.isUnlocked = true
        if !greeted {
            greeted = true
            if speakReplies { voice.speak("Hey! What can I help you with today?", voiceID: voiceID) }
        }
    }
}

struct DonnaSettings: View {
    @Environment(\.dismiss) private var dismiss
    let model: DonnaModel
    let voice: VoiceController
    @State private var email = ""
    @State private var password = ""
    @State private var message = ""
    @State private var busy = false
    @AppStorage("backendURL") private var backendURL = ""
    @AppStorage("supabaseURL") private var supabaseURL = "https://icxeuhkqxxhdkfdappio.supabase.co"
    @AppStorage("publishableKey") private var key = ""
    @AppStorage("allowBusinessReads") private var allowReads = false
    @AppStorage("speakReplies") private var speakReplies = false
    @AppStorage("voiceID") private var voiceID = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Free, on-device intelligence") {
                    Text(model.modelStatus)
                    Text("No cloud AI fallback, paid speech, calling or notification schedule is configured.")
                    Toggle("Allow authenticated business read tools", isOn: $allowReads)
                    Text("When enabled, Donna can request tasks, orders, inventory and approved memory from your configured backend. Data is processed by the model on this iPhone.").font(.caption)
                }
                Section("Command Center staging connection") {
                    TextField("HTTPS backend origin", text: $backendURL).textContentType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Supabase HTTPS origin", text: $supabaseURL).textContentType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("sb_publishable public key", text: $key).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Text("Only configure a backend you control. Signing in sends credentials to the Supabase origin and an access token to the backend origin.").font(.caption)
                    TextField("Owner email", text: $email).textContentType(.username).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $password).textContentType(.password)
                    Button("Sign in") {
                        busy = true
                        Task {
                            defer { password = ""; busy = false }
                            do {
                                try await BackendClient.shared.signIn(supabaseURL: supabaseURL, key: key,
                                    backendURL: backendURL, email: email, password: password)
                                message = "Authenticated as an authorized Command Center administrator."
                            } catch { message = error.localizedDescription }
                        }
                    }.disabled(busy || email.isEmpty || password.isEmpty)
                    Button("Sign out and clear this session", role: .destructive) {
                        Task {
                            await BackendClient.shared.signOut(supabaseURL: supabaseURL, key: key)
                            allowReads = false
                            model.reset()
                            voice.silence()
                            message = "Signed out. Conversation context and token cleared."
                        }
                    }
                    if !message.isEmpty { Text(message).font(.caption) }
                }
                Section("Voice") {
                    Toggle("Speak replies aloud", isOn: $speakReplies)
                    Picker("System voice", selection: $voiceID) {
                        Text("System default").tag("")
                        ForEach(AVSpeechSynthesisVoice.speechVoices(), id: \.identifier) { voice in
                            Text("\(voice.name) · \(voice.language)").tag(voice.identifier)
                        }
                    }
                    Button("Preview voice") {
                        voice.speak("Hey! What can I help you with today?", voiceID: voiceID)
                    }
                    Button("Stop speaking") { voice.silence() }
                    Text("Installed voices and quality vary. Choose the adult female voice you prefer; Donna does not guarantee one is installed. Recording requires a tap and local recognition support.").font(.caption)
                }
                Section("Conversation privacy") {
                    Text("Native transcripts stay in memory only and are cleared when Donna becomes inactive, when you clear the conversation, or when the process closes. Approved long-term memory is managed separately in the web workspace.")
                    Button("Clear conversation", role: .destructive) { model.reset(); voice.silence() }
                }
            }
            .navigationTitle("Donna settings")
            .toolbar { Button("Done") { dismiss() } }
        }
    }
}
