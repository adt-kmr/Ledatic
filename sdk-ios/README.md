# Citadel SDK — iOS

Native iOS SDK for collecting behavioral biometrics from mobile banking users. Captures keystroke dynamics, touch patterns, and environmental signals, then uploads them to the Citadel backend for risk analysis.

## Setup

1. Open `sdk-ios/` in Xcode
2. Resolve Swift packages (DeviceKit is declared in the project)
3. Build and run the `CitadelDemo` scheme on a simulator or device (iOS 16+)

The demo app launches with two input fields (Customer ID, Password) and a Login button. Signals are captured in real time and displayed in the UI.

## Configuration

All SDK behavior is driven by a single `SDKConfig`:

```swift
let config = SDKConfig(
    apiUrl: "http://your-backend:8000",
    userId: "user-123",
    channel: "mobile_banking",           // optional, default "mobile_banking"
    imeiHash: DeviceIdentity.getDeviceHash(secret: "your-hmac-secret"),
    flushIntervalMs: 500                 // optional, default 500
)

let sdk = BehaviorSDK(config: config)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `apiUrl` | `String` | required | Backend base URL |
| `userId` | `String` | required | End-user identifier |
| `channel` | `String` | `"mobile_banking"` | Logical channel name |
| `imeiHash` | `String` | required | HMAC-SHA256 hash of device identifier |
| `flushIntervalMs` | `TimeInterval` | `500` | How often buffered signals are flushed (ms) |

## Features

### Keystroke Dynamics

`KeystrokeCollector` attaches to `UITextField` via delegate and `UITextField.textDidChangeNotification`. Each keystroke produces a `KeystrokeEvent` containing:

- **key** — sanitized to `ALPHA`, `DIGIT`, or `SPECIAL` (never raw characters)
- **eventType** — `keydown`
- **flightTime** — ms since the previous keystroke

### Touch Biometrics

`TouchCollector` overlays a transparent `TouchInterceptor` on the target view. Each touch produces a `TouchSignal` with:

- **x, y** — touch coordinates in the view's coordinate space
- **pressure** — force of the press (`UITouch.force`)
- **touchSize** — contact area radius (`UITouch.majorRadius`)
- **eventType** — `touchstart` or `touchend`

### Device ID Hash

`DeviceIdentity.getDeviceHash()` reads `identifierForVendor` (or falls back to device model info via DeviceKit) and returns an HMAC-SHA256 hex digest using CryptoKit. No special permissions required.

### Screen-Share Detection

`EnvironmentCollector` listens for `UIScreen.capturedDidChangeNotification`. The `screenShareActive` flag reflects `UIScreen.main.isCaptured` at snapshot time.

### Clipboard Detection

A `UIPasteboard.changedNotification` observer sets `clipboardSource` to `"system"` whenever the pasteboard changes.

## Signal Flow

```
User input (keystrokes, touches)
        │
        ▼
   KeystrokeCollector ──┐
                        ├──► SignalBundle ──► SignalUploader ──► POST /api/signals/ingest
   TouchCollector ──────┘
                        ┌───────────────┐
  EnvironmentCollector ─┘  (snapshot)   │
                                        │
     Timer (every flushIntervalMs) ─────┘
```

1. Collectors attach to input fields and the root view on `sdk.start()`
2. Each collector appends events to the shared `SignalBundle`
3. A periodic `Timer` calls `flush()`, which:
   - Takes an environment snapshot (screen share, clipboard, tab visibility, resolution)
   - Sends the full bundle as JSON via HTTP POST
   - Replaces the bundle with a fresh one for the next interval
4. `sdk.stop()` invalidates the timer, detaches collectors, and performs a final flush

## File Overview

| File | Purpose |
|---|---|
| `BehaviorSDK.swift` | Entry point — orchestrates collectors, timer, and flush |
| `SDKConfig` | Configuration struct |
| `KeystrokeCollector.swift` | UITextField delegate-based keystroke capture |
| `TouchCollector.swift` | UIView overlay-based touch capture |
| `EnvironmentCollector.swift` | Screen share, clipboard, app lifecycle, resolution |
| `DeviceIdentity.swift` | Device ID hashing (CryptoKit + DeviceKit) |
| `SignalBundle.swift` | Codable data models (events, signals, environment, bundle) |
| `SignalUploader.swift` | URLSession-based HTTP POST uploader |

## Requirements

- **Platform**: iOS 16+
- **Language**: Swift 5.9+
- **Frameworks**: SwiftUI, UIKit, CryptoKit
- **Dependencies**: DeviceKit (Swift Package)
