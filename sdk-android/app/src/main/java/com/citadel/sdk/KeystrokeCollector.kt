package com.citadel.sdk

import android.text.Editable
import android.text.TextWatcher
import android.widget.EditText

class KeystrokeCollector(private val bundle: SignalBundle) {
    private var lastKeyDownTime: Long = 0
    private var lastKeyUpTime: Long = 0
    private var totalSignals: Int = 0

    fun attach(editText: EditText) {
        editText.addTextChangedListener(object : TextWatcher {
            private var beforeText: String = ""
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {
                beforeText = s?.toString() ?: ""
            }
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                val newText = s?.toString() ?: ""
                if (newText.length > beforeText.length) {
                    val now = System.currentTimeMillis()
                    lastKeyDownTime = now
                    val flightTime = if (lastKeyUpTime > 0) (now - lastKeyUpTime).toDouble() else null
                    bundle.keystrokeEvents.add(KeystrokeEvent(
                        key = sanitizeKey(newText.last()),
                        eventType = "keydown",
                        timestamp = now,
                        flightTime = flightTime
                    ))
                    totalSignals++
                } else if (newText.length < beforeText.length) {
                    val now = System.currentTimeMillis()
                    val dwellTime = (now - lastKeyDownTime).toDouble()
                    lastKeyUpTime = now
                    bundle.keystrokeEvents.add(KeystrokeEvent(
                        key = "BACKSPACE",
                        eventType = "keyup",
                        timestamp = now,
                        dwellTime = dwellTime
                    ))
                    totalSignals++
                }
            }
        })
    }

    fun getTotalSignals(): Int = totalSignals

    private fun sanitizeKey(c: Char): String = when {
        c.isLetter() -> "ALPHA"
        c.isDigit() -> "DIGIT"
        else -> "SPECIAL"
    }
}