import Foundation
import Observation
import UIKit
@preconcurrency import AVFoundation
@preconcurrency import Speech

@MainActor @Observable final class VoiceController {
    var isRecording = false
    var isStarting = false
    var transcript = ""
    var issue = ""
    private let engine = AVAudioEngine()
    private let synthesizer = AVSpeechSynthesizer()
    private var recognition: SFSpeechRecognitionTask?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var hasTap = false
    private var timeout: Task<Void, Never>?
    private var generation = 0

    func start() async {
        guard !isRecording else { stop(); return }
        guard !isStarting, NativeAccess.isUnlocked,
              UIApplication.shared.applicationState == .active else { return }
        isStarting = true
        generation += 1
        let operationID = generation
        defer { if operationID == generation { isStarting = false } }
        synthesizer.stopSpeaking(at: .immediate)
        issue = ""
        let authorized = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
        guard operationID == generation, NativeAccess.isUnlocked else { return }
        guard authorized else {
            issue = "Microphone and speech permission are needed. You can still type your request."
            return
        }
        let microphoneAllowed = await AVAudioApplication.requestRecordPermission()
        guard operationID == generation, NativeAccess.isUnlocked,
              UIApplication.shared.applicationState == .active else { return }
        guard microphoneAllowed else {
            issue = "Microphone permission is needed. You can still type your request."
            return
        }
        guard let recognizer = SFSpeechRecognizer(locale: Locale.current),
              recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
            issue = "On-device speech recognition isn't available for this language. Please use the keyboard; audio won't be sent to a server."
            return
        }
        do {
            try AVAudioSession.sharedInstance().setCategory(.record, mode: .measurement, options: .duckOthers)
            try AVAudioSession.sharedInstance().setActive(true, options: .notifyOthersOnDeactivation)
            let audio = SFSpeechAudioBufferRecognitionRequest()
            audio.requiresOnDeviceRecognition = true
            audio.shouldReportPartialResults = true
            audio.contextualStrings = ["Persen Apparel", "Donna", "Ninja Transfers", "DTF"]
            request = audio
            transcript = ""
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                throw DonnaError.message("The microphone isn't ready. Try again.")
            }
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in audio.append(buffer) }
            hasTap = true
            recognition = recognizer.recognitionTask(with: audio) { [weak self] result, error in
                let words = result?.bestTranscription.formattedString
                let ended = result?.isFinal == true || error != nil
                let message = error?.localizedDescription
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    guard self.generation == operationID, NativeAccess.isUnlocked else { return }
                    if let words { self.transcript = words }
                    if ended {
                        self.stop()
                        if let message, words == nil { self.issue = message }
                    }
                }
            }
            engine.prepare()
            try engine.start()
            isRecording = true
            timeout = Task { [weak self] in
                try? await Task.sleep(for: .seconds(45))
                guard !Task.isCancelled else { return }
                self?.stop()
            }
        } catch {
            stop()
            issue = error.localizedDescription
        }
    }

    func stop() {
        generation += 1
        isStarting = false
        timeout?.cancel()
        timeout = nil
        engine.stop()
        if hasTap { engine.inputNode.removeTap(onBus: 0); hasTap = false }
        request?.endAudio()
        recognition?.cancel()
        recognition = nil
        request = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    func speak(_ text: String, voiceID: String) {
        stop()
        synthesizer.stopSpeaking(at: .immediate)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(identifier: voiceID) ?? AVSpeechSynthesisVoice(language: Locale.current.identifier)
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        synthesizer.speak(utterance)
    }

    func silence() { stop(); synthesizer.stopSpeaking(at: .immediate) }
    func clear() { silence(); transcript = ""; issue = "" }
}
