import Foundation
import Security

enum DonnaError: LocalizedError {
    case message(String)
    var errorDescription: String? { switch self { case .message(let text): text } }
}

/// Only an access token is stored. Passwords, customer data and conversations are not persisted.
enum TokenVault {
    private static let service = "com.persenapparel.donna.session"
    static func read() -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "access",
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var value: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &value) == errSecSuccess,
              let data = value as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func save(_ token: String) throws {
        remove()
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "access",
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecValueData as String: Data(token.utf8)]
        guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else {
            throw DonnaError.message("Could not save your session securely.")
        }
    }
    static func remove() {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "access"] as CFDictionary)
    }
}

/// Rejects redirects so the bearer token cannot follow a redirect to another host.
final class NoRedirect: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

actor BackendClient {
    static let shared = BackendClient()
    private let network: URLSession = {
        let settings = URLSessionConfiguration.ephemeral
        settings.timeoutIntervalForRequest = 25
        settings.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: settings, delegate: NoRedirect(), delegateQueue: nil)
    }()

    private func origin(_ value: String) throws -> URL {
        guard let url = URL(string: value), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" else {
            throw DonnaError.message("Enter an HTTPS origin, such as https://your-staging.pages.dev, without a path.")
        }
        return url
    }

    func signIn(supabaseURL: String, key: String, backendURL: String,
                email: String, password: String) async throws {
        let base = try origin(supabaseURL)
        _ = try origin(backendURL)
        guard key.hasPrefix("sb_publishable_") else {
            throw DonnaError.message("Use the project's public sb_publishable key. Secret and service-role keys are not accepted.")
        }
        var components = URLComponents(url: base.appending(path: "auth/v1/token"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "grant_type", value: "password")]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue(key, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["email": email, "password": password])
        let (data, response) = try await network.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let result = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = result["access_token"] as? String else {
            throw DonnaError.message("Sign-in failed. Check your account details and project settings.")
        }
        try TokenVault.save(token)
        do {
            let status = try await read("status", backendURL: backendURL)
            guard let data = status.data(using: .utf8),
                  let result = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  result["admin"] as? Bool == true else {
                throw DonnaError.message("This account is not an authorized Command Center administrator.")
            }
        }
        catch { TokenVault.remove(); throw error }
    }

    func read(_ tool: String, backendURL: String, accessGeneration: Int? = nil) async throws -> String {
        try Task.checkCancellation()
        guard await MainActor.run(body: {
            NativeAccess.isUnlocked && (accessGeneration == nil || accessGeneration == NativeAccess.generation)
        }) else {
            throw DonnaError.message("Unlock Donna before reading business information.")
        }
        let allowed: Set<String> = ["status", "tasks", "orders", "inventory", "invoices",
                                     "payments", "contacts", "agreements", "events", "memories"]
        guard allowed.contains(tool) else { throw DonnaError.message("This read tool is not allowed.") }
        guard let token = TokenVault.read() else { throw DonnaError.message("Sign in to Command Center first.") }
        let base = try origin(backendURL)
        var request = URLRequest(url: base.appending(path: "api/donna/\(tool)"))
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await network.data(for: request)
        try Task.checkCancellation()
        guard await MainActor.run(body: {
            NativeAccess.isUnlocked && (accessGeneration == nil || accessGeneration == NativeAccess.generation)
        }) else {
            throw DonnaError.message("Donna locked before the read finished. Please unlock and load again.")
        }
        guard let response = response as? HTTPURLResponse else { throw DonnaError.message("Invalid server response.") }
        if response.statusCode == 401 { TokenVault.remove(); throw DonnaError.message("Your session expired. Please sign in again.") }
        guard response.statusCode == 200 else {
            throw DonnaError.message("The \(tool) read is unavailable (HTTP \(response.statusCode)). No records were changed.")
        }
        guard data.count <= 2_000_000 else { throw DonnaError.message("Response exceeds the local safety limit.") }
        let json = try JSONSerialization.jsonObject(with: data)
        // Approval is enforced again locally before memory can become model context.
        if tool == "memories" {
            let object = json as? [String: Any]
            let rows = (object?["rows"] ?? object?["memories"] ?? json) as? [[String: Any]] ?? []
            let approved = rows.filter { $0["status"] as? String == "confirmed" }
            let safe = approved.prefix(20).map { row in
                ["title": row["title"] ?? "", "content": row["content"] ?? "",
                 "source": row["source"] ?? "", "updated_at": row["updated_at"] ?? ""]
            }
            return String(decoding: try JSONSerialization.data(withJSONObject: safe, options: [.prettyPrinted, .sortedKeys]), as: UTF8.self)
        }
        return String(decoding: try JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys]), as: UTF8.self)
    }

    func signOut(supabaseURL: String, key: String) async {
        defer { TokenVault.remove() }
        guard let token = TokenVault.read(), let base = try? origin(supabaseURL) else { return }
        var request = URLRequest(url: base.appending(path: "auth/v1/logout"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(key, forHTTPHeaderField: "apikey")
        _ = try? await network.data(for: request)
    }
}
