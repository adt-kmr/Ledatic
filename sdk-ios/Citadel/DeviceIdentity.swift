import Foundation
import CryptoKit
import DeviceKit

enum DeviceIdentity {
    static func getDeviceHash(secret: String) -> String {
        let rawId = getDeviceIdentifier()
        return computeHMACSHA256(plaintext: rawId, secret: secret)
    }

    private static func getDeviceIdentifier() -> String {
        if let vendorID = UIDevice.current.identifierForVendor?.uuidString {
            return vendorID
        }
        let device = Device.current
        return "unknown|\(device.safeDescription)|\(device.model)"
    }

    private static func computeHMACSHA256(plaintext: String, secret: String) -> String {
        let key = SymmetricKey(data: Data(secret.utf8))
        let signature = HMAC<SHA256>.authenticationCode(
            for: Data(plaintext.utf8),
            using: key
        )
        return signature.map { String(format: "%02x", $0) }.joined()
    }
}
