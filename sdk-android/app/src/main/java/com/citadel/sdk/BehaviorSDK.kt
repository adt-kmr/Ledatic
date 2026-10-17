package com.citadel.sdk

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.widget.EditText
import java.util.UUID

class BehaviorSDK(private val config: SDKConfig) {
    val sessionId: String = UUID.randomUUID().toString()

    private var bundle: SignalBundle? = null
    private var keystrokeCollector: KeystrokeCollector? = null
    private var touchCollector: TouchCollector? = null
    private var environmentCollector: EnvironmentCollector? = null
    private var signalUploader: SignalUploader? = null
    private var handler: Handler? = null
    private var flushRunnable: Runnable? = null
    private var isRunning = false

    fun start(activity: Activity, inputFields: List<EditText>) {
        if (isRunning) return
        isRunning = true

        val env = EnvironmentSignals(
            screenShareActive = false,
            clipboardSource = "none",
            tabVisible = true,
            deviceType = "mobile",
            userAgent = "",
            screenResolution = ""
        )

        bundle = SignalBundle(
            sessionId = sessionId,
            userId = config.userId,
            channel = config.channel,
            imeiHash = config.imeiHash,
            keystrokeEvents = mutableListOf(),
            touchEvents = mutableListOf(),
            environment = env,
            timestampMs = System.currentTimeMillis()
        )

        keystrokeCollector = KeystrokeCollector(bundle!!)
        touchCollector = TouchCollector(bundle!!)
        environmentCollector = EnvironmentCollector(activity)
        signalUploader = SignalUploader(config.apiUrl)

        inputFields.forEach { keystrokeCollector!!.attach(it) }
        val root = activity.findViewById<android.view.View>(android.R.id.content)
        touchCollector!!.attach(root)
        environmentCollector!!.init()

        handler = Handler(Looper.getMainLooper())
        flushRunnable = object : Runnable {
            override fun run() {
                flush()
                handler?.postDelayed(this, config.flushIntervalMs)
            }
        }
        handler?.postDelayed(flushRunnable!!, config.flushIntervalMs)
    }

    fun stop() {
        if (!isRunning) return
        isRunning = false

        flushRunnable?.let { handler?.removeCallbacks(it) }
        flush()
        environmentCollector?.destroy()
    }

    private fun flush() {
        val currentBundle = bundle ?: return
        if (currentBundle.keystrokeEvents.isEmpty() && currentBundle.touchEvents.isEmpty()) return

        val environment = environmentCollector?.snapshot() ?: currentBundle.environment
        val toSend = currentBundle.copy(
            environment = environment,
            timestampMs = System.currentTimeMillis()
        )

        Thread {
            signalUploader?.send(toSend)
        }.start()

        currentBundle.keystrokeEvents.clear()
        currentBundle.touchEvents.clear()
        currentBundle.timestampMs = System.currentTimeMillis()
    }

    fun getTotalSignalCount(): Int {
        val ks = keystrokeCollector?.getTotalSignals() ?: 0
        val ts = touchCollector?.getTotalSignals() ?: 0
        return ks + ts
    }
}

data class SDKConfig(
    val apiUrl: String,
    val userId: String,
    val channel: String = "mobile_banking",
    val imeiHash: String,
    val flushIntervalMs: Long = 500
)
