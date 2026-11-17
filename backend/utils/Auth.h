#pragma once
#include <drogon/drogon.h>
#include <jwt-cpp/jwt.h>
#include <chrono>
#include <cstdlib>
#include <stdexcept>
#include <string>
#include "RuntimeConfig.h"
#include "../models/DatabaseManager.h"
#include "ExpertRules.h"
#include <bsoncxx/builder/stream/document.hpp>
#include <bsoncxx/oid.hpp>
#include <mongocxx/client.hpp>
#include <mongocxx/database.hpp>
#include <mongocxx/collection.hpp>

namespace auth {
inline const std::string& secret() {
    static const std::string key = [] {
        const auto value = config::value("JWT_SECRET");
        if (value.size() < 32 || value == "super_secret_key_change_me")
            throw std::runtime_error("Set JWT_SECRET to a random secret of at least 32 characters");
        return value;
    }();
    return key;
}
inline std::string issue(const std::string& subject, const std::string& role,
                         const std::string& audience = "tranquil-api",
                         int minutes = 60, int version = 0) {
    const auto now = std::chrono::system_clock::now();
    return jwt::create().set_issuer("tranquil_talk").set_type("JWT")
        .set_subject(subject).set_audience(audience).set_issued_at(now)
        .set_expires_at(now + std::chrono::minutes(minutes))
        .set_payload_claim("role", jwt::claim(role))
        .set_payload_claim("version", jwt::claim(std::to_string(version)))
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
class Unavailable : public std::runtime_error {
public: Unavailable() : std::runtime_error("Account service unavailable") {}
};
inline Identity currentIdentity(const std::string& id) {
    try {
        using namespace bsoncxx::builder::stream;
        auto client = DatabaseManager::getInstance().getConnection();
        auto db = client->database("tranquil_talk");
        auto filter = document{} << "_id" << bsoncxx::oid(id) << finalize;
        auto user = db.collection("users").find_one(filter.view());
        if (!user) throw std::invalid_argument("Account unavailable");
        for(const auto* field:{"disabled","deleted"}) {
            const auto flag=user->view()[field];
            // Older records may omit optional flags; a null flag is the same default.
            // Other unexpected types fail closed instead of being cast to a boolean.
            if(flag && flag.type()!=bsoncxx::type::k_null &&
                (flag.type()!=bsoncxx::type::k_bool || flag.get_bool().value))
                throw std::invalid_argument("Account unavailable");
        }
        std::string role(user->view()["role"].get_string().value);
        if (!experts::contains({"patient","expert_pending","expert","admin"},role))
            throw std::invalid_argument("Account unavailable");
        if (role == "expert") {
            auto profile = db.collection("expert_profiles").find_one(filter.view());
            if (!profile || !profile->view()["approvedRevision"] ||
                !experts::approved(std::string(profile->view()["status"].get_string().value),
                    profile->view()["revision"].get_int32().value,
                    profile->view()["approvedRevision"].get_int32().value))
                role = "expert_pending";
        }
        return {id,role};
    } catch (const std::invalid_argument&) { throw; }
    catch (const std::exception&) { throw Unavailable(); }
}
inline Identity require(const drogon::HttpRequestPtr& request) {
    const auto header = request->getHeader("authorization");
    if (header.rfind("Bearer ", 0) != 0) throw std::invalid_argument("Sign in required");
    const auto token=header.substr(7);
    auto identity=currentIdentity(verify(token).id);
    auto client=DatabaseManager::getInstance().getConnection();
    using namespace bsoncxx::builder::stream;
    auto user=client->database("tranquil_talk").collection("users").find_one(
        document{} << "_id" << bsoncxx::oid(identity.id) << finalize);
    if(!user)throw std::invalid_argument("Account unavailable");
    const int version=user->view()["sessionVersion"] ? user->view()["sessionVersion"].get_int32().value : 0;
    auto decoded=jwt::decode(token);
    const auto issuedVersion=decoded.has_payload_claim("version") ? decoded.get_payload_claim("version").as_string() : "0";
    if(issuedVersion!=std::to_string(version))throw std::invalid_argument("Session ended");
    return identity;
}
}
