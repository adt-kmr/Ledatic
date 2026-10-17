import Foundation
import UIKit

class EnvironmentCollector {
    private var screenShareActive = false
    private var clipboardSource = "none"
    private var tabVisible = true

    func start() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidBecomeActive),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(clipboardChanged),
            name: UIPasteboard.changedNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(screenCaptureChanged),
            name: UIScreen.capturedDidChangeNotification,
            object: nil
        )
    }

    func stop() {
        NotificationCenter.default.removeObserver(self)
    }

    func buildEnvironment() -> EnvironmentSignals {
        let screen = UIScreen.main
        let scale = screen.scale
        let width = Int(screen.bounds.width * scale)
        let height = Int(screen.bounds.height * scale)

        return EnvironmentSignals(
            screenShareActive: screenShareActive,
            clipboardSource: clipboardSource,
            tabVisible: tabVisible,
            deviceType: UIDevice.current.userInterfaceIdiom == .pad ? "tablet" : "mobile",
            userAgent: userAgentString(),
            screenResolution: "\(width)x\(height)"
        )
    }

    @objc private func appDidBecomeActive() {
        tabVisible = true
    }

    @objc private func appDidEnterBackground() {
        tabVisible = false
    }

    @objc private func clipboardChanged() {
        clipboardSource = "system"
    }

    @objc private func screenCaptureChanged() {
        screenShareActive = UIScreen.main.isCaptured
    }

    private func userAgentString() -> String {
        let device = UIDevice.current
        return "iOS/\(device.systemVersion) \(device.model)"
    }
}
