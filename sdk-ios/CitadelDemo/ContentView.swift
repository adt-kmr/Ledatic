import SwiftUI

struct ContentView: View {
    @State private var customerId = ""
    @State private var password = ""
    @State private var signalCount = 0
    @State private var deviceHash = ""
    @State private var sdk: BehaviorSDK?

    private let config = SDKConfig(
        apiUrl: "http://localhost:8000",
        userId: "demo_user",
        channel: "mobile_banking",
        imeiHash: ""
    )

    var body: some View {
        VStack(spacing: 20) {
            Text("Citadel Demo")
                .font(.largeTitle)
                .fontWeight(.bold)

            VStack(alignment: .leading, spacing: 12) {
                TextField("Customer ID", text: $customerId)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()

                SecureField("Password", text: $password)
                    .textFieldStyle(.roundedBorder)
            }
            .padding(.horizontal)

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Device Hash:")
                        .fontWeight(.medium)
                    Spacer()
                    Text(String(deviceHash.prefix(16)))
                        .font(.system(.body, design: .monospaced))
                        .foregroundColor(.secondary)
                }

                HStack {
                    Text("Signals Captured:")
                        .fontWeight(.medium)
                    Spacer()
                    Text("\(signalCount)")
                        .font(.system(.body, design: .monospaced))
                        .foregroundColor(.blue)
                }
            }
            .padding()
            .background(Color(.systemGray6))
            .cornerRadius(10)
            .padding(.horizontal)

            Button(action: login) {
                Text("Login")
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(10)
            }
            .padding(.horizontal)
            .disabled(customerId.isEmpty || password.isEmpty)

            Spacer()
        }
        .padding(.top)
        .onAppear {
            deviceHash = DeviceIdentity.getDeviceHash(secret: "demo_secret")
            sdk = BehaviorSDK(config: config)
            startTimer()
        }
    }

    private func login() {
        guard let window = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first?.windows
            .first else { return }

        sdk?.start(view: window, inputFields: [])
    }

    private func startTimer() {
        Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { _ in
            signalCount = sdk?.getTotalSignalCount() ?? 0
        }
    }
}

#Preview {
    ContentView()
}
