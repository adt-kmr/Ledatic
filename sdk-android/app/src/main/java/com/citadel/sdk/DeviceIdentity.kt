package com.citadel.sdk

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat

object DeviceIdentity {
    fun getImeiHash(context: Context, secret: String): String {
        val rawId = getDeviceIdentifier(context)
        return HMACUtil.computeHmacSha256(rawId, secret)
    }

    private fun getDeviceIdentifier(context: Context): String {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE)
            == PackageManager.PERMISSION_GRANTED
        ) {
            try {
                val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    return tm.imei
                } else {
                    @Suppress("DEPRECATION")
                    return tm.deviceId
                }
            } catch (_: SecurityException) {
            }
        }
        val androidId = android.provider.Settings.Secure.getString(
            context.contentResolver,
            android.provider.Settings.Secure.ANDROID_ID
        )
        return "$androidId|${Build.BOARD}|${Build.MANUFACTURER}|${Build.MODEL}"
    }
}
