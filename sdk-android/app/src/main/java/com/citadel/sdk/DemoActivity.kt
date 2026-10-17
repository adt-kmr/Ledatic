package com.citadel.sdk

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.citadel.sdk.databinding.ActivityDemoBinding

class DemoActivity : AppCompatActivity() {
    private lateinit var binding: ActivityDemoBinding
    private lateinit var sdk: BehaviorSDK
    private lateinit var handler: Handler
    private lateinit var signalRunnable: Runnable

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityDemoBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val imeiHash = DeviceIdentity.getImeiHash(this, "demo-secret-key")
        binding.tvImeiHash.text = "IMEI: ${imeiHash.take(16)}"

        val config = SDKConfig(
            apiUrl = "http://10.0.2.2:8000",
            userId = "demo-user",
            imeiHash = imeiHash
        )
        sdk = BehaviorSDK(config)

        val inputFields = listOf(binding.editCustomerId, binding.editPassword)
        sdk.start(this, inputFields)

        handler = Handler(Looper.getMainLooper())
        signalRunnable = object : Runnable {
            override fun run() {
                binding.tvSignalCount.text = "Signals: ${sdk.getTotalSignalCount()}"
                handler.postDelayed(this, 200)
            }
        }
        handler.post(signalRunnable)

        binding.btnLogin.setOnClickListener {
            val count = sdk.getTotalSignalCount()
            Toast.makeText(this, "Signal count: $count", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacks(signalRunnable)
        sdk.stop()
    }
}
