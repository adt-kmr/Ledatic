package com.citadel.sdk

import org.json.JSONArray
import org.json.JSONObject

data class KeystrokeEvent(
    val key: String,
    val eventType: String,
    val timestamp: Long,
    val dwellTime: Double? = null,
    val flightTime: Double? = null
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("key", key)
        put("eventType", eventType)
        put("timestamp", timestamp)
        dwellTime?.let { put("dwellTime", it) }
        flightTime?.let { put("flightTime", it) }
    }
}

data class TouchSignal(
    val x: Float,
    val y: Float,
    val pressure: Float,
    val touchSize: Float,
    val eventType: String,
    val timestamp: Long
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("x", x.toDouble())
        put("y", y.toDouble())
        put("pressure", pressure.toDouble())
        put("touchSize", touchSize.toDouble())
        put("eventType", eventType)
        put("timestamp", timestamp)
    }
}

data class EnvironmentSignals(
    val screenShareActive: Boolean,
    val clipboardSource: String,
    val tabVisible: Boolean,
    val deviceType: String,
    val userAgent: String,
    val screenResolution: String
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("screenShareActive", screenShareActive)
        put("clipboardSource", clipboardSource)
        put("tabVisible", tabVisible)
        put("deviceType", deviceType)
        put("userAgent", userAgent)
        put("screenResolution", screenResolution)
    }
}

data class SignalBundle(
    val sessionId: String,
    val userId: String,
    val channel: String,
    val imeiHash: String,
    val keystrokeEvents: List<KeystrokeEvent>,
    val touchEvents: List<TouchSignal>,
    val mouseEvents: List<Any> = emptyList(),
    val navigationEvents: List<Any> = emptyList(),
    val environment: EnvironmentSignals,
    val timestampMs: Long
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("sessionId", sessionId)
        put("userId", userId)
        put("channel", channel)
        put("imeiHash", imeiHash)
        put("keystrokeEvents", JSONArray().apply {
            keystrokeEvents.forEach { put(it.toJson()) }
        })
        put("touchEvents", JSONArray().apply {
            touchEvents.forEach { put(it.toJson()) }
        })
        put("mouseEvents", JSONArray())  // no mouse on mobile
        put("navigationEvents", JSONArray())
        put("environment", environment.toJson())
        put("timestampMs", timestampMs)
    }

    fun toJsonString(): String = toJson().toString()
}
