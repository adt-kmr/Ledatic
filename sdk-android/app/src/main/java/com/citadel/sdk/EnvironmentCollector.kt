package com.citadel.sdk

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.view.WindowManager

class EnvironmentCollector(private val activity: Activity) {
    private var screenShareActive = false
    private var clipboardSource = "none"
    private var tabVisible = true
    private val mainHandler = Handler(Looper.getMainLooper())

    private var clipboardListener: ClipboardManager.OnPrimaryClipChangedListener? = null
    private var lifecycleCallbacks: android.app.Application.ActivityLifecycleCallbacks? = null

    fun init() {
        registerClipboardListener()
        registerLifecycleCallbacks()
        detectScreenShare()
    }

    private fun registerClipboardListener() {
        val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboardListener = ClipboardManager.OnPrimaryClipChangedListener {
            clipboardSource = "clipboard_paste"
        }
        clipboard.addPrimaryClipChangedListener(clipboardListener)
    }

    private fun registerLifecycleCallbacks() {
        lifecycleCallbacks = object : android.app.Application.ActivityLifecycleCallbacks {
            override fun onActivityResumed(activity: Activity) { tabVisible = true }
            override fun onActivityPaused(activity: Activity) { tabVisible = false }
            override fun onActivityCreated(activity: Activity, savedInstanceState: android.os.Bundle?) {}
            override fun onActivityStarted(activity: Activity) {}
            override fun onActivityStopped(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, outState: android.os.Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        }
        activity.application.registerActivityLifecycleCallbacks(lifecycleListener(lifecycleCallbacks!!))
    }

    private fun lifecycleListener(callbacks: android.app.Application.ActivityLifecycleCallbacks) = callbacks

    private fun detectScreenShare() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val displayManager = activity.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
            val displays = displayManager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION)
            screenShareActive = displays.isNotEmpty()
        }
    }

    fun snapshot(): EnvironmentSignals {
        val wm = activity.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(metrics)
        val resolution = "${metrics.widthPixels}x${metrics.heightPixels}"
        val userAgent = "Android ${Build.VERSION.RELEASE}; ${Build.MANUFACTURER} ${Build.MODEL}"

        return EnvironmentSignals(
            screenShareActive = screenShareActive,
            clipboardSource = clipboardSource,
            tabVisible = tabVisible,
            deviceType = "mobile",
            userAgent = userAgent,
            screenResolution = resolution
        )
    }

    fun destroy() {
        val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboardListener?.let { clipboard.removePrimaryClipChangedListener(it) }
        lifecycleCallbacks?.let { activity.application.unregisterActivityLifecycleCallbacks(it) }
    }
}
