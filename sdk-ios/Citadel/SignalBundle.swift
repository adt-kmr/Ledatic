import Foundation

struct KeystrokeEvent: Codable {
    let key: String
    let eventType: String
    let timestamp: Int64
    let dwellTime: Double?
    let flightTime: Double?

    enum CodingKeys: String, CodingKey {
        case key, eventType, timestamp, dwellTime, flightTime
    }
}

struct TouchSignal: Codable {
    let x: Double
    let y: Double
    let pressure: Double
    let touchSize: Double
    let eventType: String
    let timestamp: Int64

    enum CodingKeys: String, CodingKey {
        case x, y, pressure, touchSize, eventType, timestamp
    }
}

struct EnvironmentSignals: Codable {
    let screenShareActive: Bool
    let clipboardSource: String
    let tabVisible: Bool
    let deviceType: String
    let userAgent: String
    let screenResolution: String

    enum CodingKeys: String, CodingKey {
        case screenShareActive, clipboardSource, tabVisible
        case deviceType, userAgent, screenResolution
    }
}

struct SignalBundle: Codable {
    let sessionId: String
    let userId: String
    let channel: String
    let imeiHash: String
    var keystrokeEvents: [KeystrokeEvent]
    var touchEvents: [TouchSignal]
    let mouseEvents: [String]
    let navigationEvents: [String]
    let environment: EnvironmentSignals
    var timestampMs: Int64

    enum CodingKeys: String, CodingKey {
        case sessionId, userId, channel, imeiHash
        case keystrokeEvents, touchEvents
        case mouseEvents, navigationEvents
        case environment, timestampMs
    }

    init(
        sessionId: String,
        userId: String,
        channel: String,
        imeiHash: String,
        keystrokeEvents: [KeystrokeEvent] = [],
        touchEvents: [TouchSignal] = [],
        environment: EnvironmentSignals,
        timestampMs: Int64
    ) {
        self.sessionId = sessionId
        self.userId = userId
        self.channel = channel
        self.imeiHash = imeiHash
        self.keystrokeEvents = keystrokeEvents
        self.touchEvents = touchEvents
        self.mouseEvents = []
        self.navigationEvents = []
        self.environment = environment
        self.timestampMs = timestampMs
    }
}
