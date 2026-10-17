import Foundation
import SwiftUI

struct SDKConfig {
    let apiUrl: String
    let userId: String
    let channel: String
    let imeiHash: String
    let flushIntervalMs: TimeInterval

    init(
        apiUrl: String,
        userId: String,
        channel: String = "mobile_banking",
        imeiHash: String,
        flushIntervalMs: TimeInterval = 500
    ) {
        self.apiUrl = apiUrl
        self.userId = userId
        self.channel = channel
        self.imeiHash = imeiHash
        self.flushIntervalMs = flushIntervalMs
    }
}

class BehaviorSDK {
    let sessionId: String
    private let config: SDKConfig
    private let uploader: SignalUploader
    private let environmentCollector = EnvironmentCollector()
    private var bundle: SignalBundle?
    private var keystrokeCollector: KeystrokeCollector?
    private var touchCollector: TouchCollector?
    private var flushTimer: Timer?
    private var isRunning = false

    init(config: SDKConfig) {
        self.config = config
        self.sessionId = UUID().uuidString
        self.uploader = SignalUploader(apiUrl: config.apiUrl)
    }

    @MainActor
    func start(view: UIView, inputFields: [UIView]) {
        guard !isRunning else { return }
        isRunning = true

        let env = environmentCollector.buildEnvironment()

        bundle = SignalBundle(
            sessionId: sessionId,
            userId: config.userId,
            channel: config.channel,
            imeiHash: config.imeiHash,
            environment: env,
            timestampMs: Int64(Date().timeIntervalSince1970 * 1000)
        )

        guard let bundle = bundle else { return }

        environmentCollector.start()

        let kc = KeystrokeCollector(bundle: bundle)
        for field in inputFields.compactMap({ $0 as? UITextField }) {
            kc.attach(field: field)
        }
        keystrokeCollector = kc

        let tc = TouchCollector(bundle: bundle)
        tc.attach(view: view)
        touchCollector = tc

        let interval = config.flushIntervalMs / 1000.0
        flushTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            self?.flush()
        }
    }

    func stop() {
        guard isRunning else { return }
        isRunning = false

        flushTimer?.invalidate()
        flushTimer = nil

        keystrokeCollector?.detach()
        keystrokeCollector = nil

        touchCollector = nil
        environmentCollector.stop()

        flush()
    }

    func getTotalSignalCount() -> Int {
        guard let bundle = bundle else { return 0 }
        return bundle.keystrokeEvents.count + bundle.touchEvents.count
    }

    func flush() {
        guard let bundle = bundle else { return }
        guard !bundle.keystrokeEvents.isEmpty || !bundle.touchEvents.isEmpty else { return }

        uploader.send(bundle: bundle)

        self.bundle = SignalBundle(
            sessionId: sessionId,
            userId: config.userId,
            channel: config.channel,
            imeiHash: config.imeiHash,
            environment: environmentCollector.buildEnvironment(),
            timestampMs: Int64(Date().timeIntervalSince1970 * 1000)
        )
    }
}
