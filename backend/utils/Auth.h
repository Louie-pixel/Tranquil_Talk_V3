#pragma once
#include <drogon/drogon.h>
#include <jwt-cpp/jwt.h>
#include <chrono>
#include <cstdlib>
#include <stdexcept>
#include <string>

namespace auth {
inline const std::string& secret() {
    static const std::string key = [] {
        const char* value = std::getenv("JWT_SECRET");
        if (!value || std::string(value).size() < 32 ||
            std::string(value) == "super_secret_key_change_me")
            throw std::runtime_error("Set JWT_SECRET to a random secret of at least 32 characters");
        return std::string(value);
    }();
    return key;
}
inline std::string issue(const std::string& subject, const std::string& role,
                         const std::string& audience = "tranquil-api",
                         int minutes = 60) {
    const auto now = std::chrono::system_clock::now();
    return jwt::create().set_issuer("tranquil_talk").set_type("JWT")
        .set_subject(subject).set_audience(audience).set_issued_at(now)
        .set_expires_at(now + std::chrono::minutes(minutes))
        .set_payload_claim("role", jwt::claim(role))
        .sign(jwt::algorithm::hs256{secret()});
}
struct Identity { std::string id; std::string role; };
inline Identity verify(const std::string& token, const std::string& audience = "tranquil-api") {
    if (token.empty() || token.size() > 4096) throw std::invalid_argument("Invalid token");
    auto decoded = jwt::decode(token);
    jwt::verify().allow_algorithm(jwt::algorithm::hs256{secret()})
        .with_issuer("tranquil_talk").with_audience(audience).verify(decoded);
    if (!decoded.has_expires_at() || decoded.get_subject().empty())
        throw std::invalid_argument("Invalid token");
    return {decoded.get_subject(), decoded.get_payload_claim("role").as_string()};
}
inline Identity require(const drogon::HttpRequestPtr& request) {
    const auto header = request->getHeader("authorization");
    if (header.rfind("Bearer ", 0) != 0) throw std::invalid_argument("Sign in required");
    return verify(header.substr(7));
}
}
