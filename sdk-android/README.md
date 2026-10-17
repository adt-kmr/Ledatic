# Citadel SDK — Android

Native Android SDK for collecting behavioral biometrics from mobile banking users. Captures keystroke dynamics, touch patterns, and environmental signals, then uploads them to the Citadel backend for risk analysis.

## Setup

1. Open `sdk-android/` in Android Studio
2. Sync Gradle (Android Studio will prompt automatically)
3. Run the app on an emulator or device (API 26+)

The demo app launches with two input fields (Customer ID, Password) and a Login button. Signals are captured in real time and displayed in the UI.

## Configuration

All SDK behavior is driven by a single `SDKConfig`:

```kotlin
val config = SDKConfig(
    apiUrl = "http://your-backend:8000",
    userId = "user-123",
    channel = "mobile_banking",   // optional, default "mobile_banking"
    imeiHash = DeviceIdentity.getImeiHash(context, "your-hmac-secret"),
    flushIntervalMs = 500         // optional, default 500ms
)

val sdk = BehaviorSDK(config)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `apiUrl` | `String` | required | Backend base URL |
| `userId` | `String` | required | End-user identifier |
| `channel` | `String` | `"mobile_banking"` | Logical channel name |
| `imeiHash` | `String` | required | HMAC-SHA256 hash of device IMEI |
| `flushIntervalMs` | `Long` | `500` | How often buffered signals are flushed (ms) |

## Features

### Keystroke Dynamics

`KeystrokeCollector` attaches to `EditText` fields via `TextWatcher`. Each keystroke produces a `KeystrokeEvent` containing:

- **key** — sanitized to `ALPHA`, `DIGIT`, or `SPECIAL` (never raw characters)
- **eventType** — `keydown` or `keyup` (backspace)
- **flightTime** — ms since the previous key event
- **dwellTime** — ms the key was held (backspace only)

### Touch Biometrics

`TouchCollector` attaches to the root view via `OnTouchListener`. Each touch produces a `TouchSignal` with:

- **x, y** — touch coordinates
- **pressure** — force of the press (device-dependent)
- **touchSize** — contact area size
- **eventType** — `touchstart` or `touchend`

### IMEI Hash

`DeviceIdentity.getImeiHash()` reads the device IMEI (or falls back to Android ID + hardware info) and returns an HMAC-SHA256 hex digest. Requires `READ_PHONE_STATE` permission for IMEI access.

### Screen-Share Detection

`EnvironmentCollector` checks for active presentation displays on API 31+ (`DisplayManager.DISPLAY_CATEGORY_PRESENTATION`). The `screenShareActive` flag is included in every environment snapshot.

### Clipboard Detection

A `ClipboardManager` listener sets `clipboardSource` to `"clipboard_paste"` whenever the system clipboard changes.

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
        Timer (every flushIntervalMs) ──┘
```

1. Collectors attach to input fields and the root view on `sdk.start()`
2. Each collector appends events to the shared `SignalBundle`
3. A periodic timer calls `flush()`, which:
   - Takes an environment snapshot (screen share, clipboard, tab visibility, resolution)
   - Sends the full bundle as JSON via HTTP POST
   - Clears the event arrays for the next interval
4. `sdk.stop()` performs a final flush and unregisters all listeners

## File Overview

| File | Purpose |
|---|---|
| `BehaviorSDK.kt` | Entry point — orchestrates collectors, timer, and flush |
| `SDKConfig` | Configuration data class |
| `KeystrokeCollector.kt` | TextWatcher-based keystroke capture |
| `TouchCollector.kt` | TouchListener-based touch capture |
| `EnvironmentCollector.kt` | Screen share, clipboard, lifecycle, resolution |
| `DeviceIdentity.kt` | IMEI/device ID hashing |
| `HMACUtil.kt` | HMAC-SHA256 implementation |
| `SignalBundle.kt` | Data models (events, signals, environment, bundle) |
| `SignalUploader.kt` | OkHttp-based HTTP POST uploader |

## Requirements

- **Min SDK**: 26 (Android 8.0)
- **Target SDK**: 34
- **Kotlin**: 1.9+
- **Dependencies**: OkHttp 4.12, AndroidX AppCompat, Material Design, Coroutines
