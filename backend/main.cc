#include <drogon/drogon.h>
#include "models/DatabaseManager.h"
#include "utils/Auth.h"
#include "utils/Validation.h"
#include <cstdlib>
#include <iostream>

namespace {
std::string env(const char* name, const std::string& fallback) {
    const auto value = std::getenv(name);
    return value ? value : fallback;
}
}
int main() {
    try {
        auth::secret(); // Fail closed before opening a listening socket.
        DatabaseManager::getInstance().init(env("MONGODB_URI",
            "mongodb://localhost:27017/?serverSelectionTimeoutMS=5000"));
        const auto port = validation::number(env("PORT", "8080"), 1, 65535);
        if (port != static_cast<int>(port)) throw std::invalid_argument("PORT must be an integer");
        drogon::app()
            .setDocumentRoot(env("WEB_ROOT", "web"))
            .setUploadPath(env("UPLOAD_PATH", "/tmp/tranquil-talk-uploads"))
            .setClientMaxBodySize(65536)
            .setClientMaxWebSocketMessageSize(65536)
            .setThreadNum(2)
            .registerPreSendingAdvice([](const drogon::HttpRequestPtr&, const drogon::HttpResponsePtr& res) {
                res->addHeader("X-Content-Type-Options", "nosniff");
                res->addHeader("Referrer-Policy", "no-referrer");
                res->addHeader("Cache-Control", "no-store");
                res->addHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(self)");
                res->addHeader("Content-Security-Policy",
                    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
                    "connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
            })
            .addListener(env("BIND_ADDRESS", "127.0.0.1"), static_cast<unsigned short>(port))
            .run();
    } catch (const std::exception&) {
        // Avoid logging database credentials from driver exception messages.
        std::cerr << "Startup failed. Check JWT_SECRET, MongoDB connectivity/indexes, PORT and WEB_ROOT.\n";
        return 1;
    }
}
