package com.citadel.sdk

import java.nio.charset.StandardCharsets
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

object HMACUtil {
    private const val ALGORITHM = "HmacSHA256"

    fun computeHmacSha256(plaintext: String, secret: String): String {
        val secretKeySpec = SecretKeySpec(secret.toByteArray(StandardCharsets.UTF_8), ALGORITHM)
        val mac = Mac.getInstance(ALGORITHM)
        mac.init(secretKeySpec)
        val hash = mac.doFinal(plaintext.toByteArray(StandardCharsets.UTF_8))
        return hash.joinToString("") { "%02x".format(it) }
    }
}
