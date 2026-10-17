package com.citadel.sdk

import android.view.MotionEvent
import android.view.View

class TouchCollector(private val bundle: SignalBundle) {
    private var totalSignals: Int = 0

    fun attach(view: View) {
        view.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    bundle.touchEvents.add(TouchSignal(
                        x = event.x, y = event.y,
                        pressure = event.pressure, touchSize = event.size,
                        eventType = "touchstart",
                        timestamp = System.currentTimeMillis()
                    ))
                    totalSignals++
                }
                MotionEvent.ACTION_UP -> {
                    bundle.touchEvents.add(TouchSignal(
                        x = event.x, y = event.y,
                        pressure = event.pressure, touchSize = event.size,
                        eventType = "touchend",
                        timestamp = System.currentTimeMillis()
                    ))
                    totalSignals++
                }
            }
            false
        }
    }

    fun getTotalSignals(): Int = totalSignals
}