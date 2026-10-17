import Foundation

class SignalUploader {
    private let apiUrl: String
    private let session: URLSession

    init(apiUrl: String) {
        self.apiUrl = apiUrl
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 5
        self.session = URLSession(configuration: config)
    }

    func send(bundle: SignalBundle) {
        guard let url = URL(string: "\(apiUrl)/api/signals/ingest") else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let encoder = JSONEncoder()
        guard let data = try? encoder.encode(bundle) else { return }

        request.httpBody = data

        session.dataTask(with: request) { _, response, error in
            if let error = error {
                print("[Citadel] Upload failed: \(error.localizedDescription)")
            }
        }.resume()
    }
}
