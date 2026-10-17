import Foundation
import UIKit

class KeystrokeCollector: NSObject {
    private var bundle: SignalBundle
    private var lastTimestamp: DispatchTime?
    private var attachedField: UITextField?
    
    init(bundle: SignalBundle) {
        self.bundle = bundle
        super.init()
    }
    
    func attach(field: UITextField) {
        guard attachedField == nil else { return }
        attachedField = field
        field.delegate = self
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(textDidChange(_:)),
            name: UITextField.textDidChangeNotification,
            object: field
        )
    }
    
    func detach() {
        guard let field = attachedField else { return }
        NotificationCenter.default.removeObserver(
            self,
            name: UITextField.textDidChangeNotification,
            object: field
        )
        field.delegate = nil
        attachedField = nil
        lastTimestamp = nil
    }
    
    func getTotalSignals() -> Int {
        return bundle.keystrokeEvents.count
    }
    
    @objc private func textDidChange(_ notification: Notification) {
        guard let field = notification.object as? UITextField,
              let text = field.text,
              !text.isEmpty else { return }
        
        let currentTimestamp = DispatchTime.now()
        let timestampMs = Int64(currentTimestamp.uptimeNanoseconds / 1_000_000)
        
        // Compute flight time
        var flightTime: Double? = nil
        if let last = lastTimestamp {
            let elapsed = Double(currentTimestamp.uptimeNanoseconds - last.uptimeNanoseconds) / 1_000_000.0
            flightTime = elapsed
        }
        
        // Get the last character entered
        if let lastChar = text.last {
            let key = sanitizeKey(String(lastChar))
            let event = KeystrokeEvent(
                key: key,
                eventType: "keydown",
                timestamp: timestampMs,
                dwellTime: nil,
                flightTime: flightTime
            )
            bundle.keystrokeEvents.append(event)
        }
        
        lastTimestamp = currentTimestamp
    }
    
    private func sanitizeKey(_ key: String) -> String {
        if key.range(of: "[a-zA-Z]", options: .regularExpression) != nil {
            return "ALPHA"
        } else if key.range(of: "[0-9]", options: .regularExpression) != nil {
            return "DIGIT"
        } else {
            return "SPECIAL"
        }
    }
}

extension KeystrokeCollector: UITextFieldDelegate {
    func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
        // Allow the text change to proceed, the notification will capture it
        return true
    }
}