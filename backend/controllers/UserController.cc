#include "UserController.h"
#include "../models/DatabaseManager.h"
#include "../utils/Auth.h"
#include "../utils/Http.h"
#include "../utils/RateLimit.h"
#include "../utils/Validation.h"
#include <bsoncxx/builder/stream/document.hpp>
#include <mongocxx/client.hpp>
#include <mongocxx/database.hpp>
#include <mongocxx/collection.hpp>
#include <mongocxx/exception/operation_exception.hpp>
#include <bcrypt/BCrypt.hpp>

using namespace bsoncxx::builder::stream;

void UserController::registerUser(const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    if (!rate_limit::allow(req->peerAddr().toIp() + ":register", 5)) {
        callback(http::error(drogon::k429TooManyRequests, "Please try again in a minute")); return;
    }
    auto json = req->getJsonObject();
    if (!json || !json->isObject() || !(*json)["email"].isString() ||
        !(*json)["password"].isString() ||
        (json->isMember("role") && !(*json)["role"].isString())) {
        callback(http::error(drogon::k400BadRequest, "Email and password are required")); return;
    }
    const auto email = validation::email((*json)["email"].asString());
    const auto password = (*json)["password"].asString();
    const auto role = json->isMember("role") ? (*json)["role"].asString() : "patient";
    if (!validation::validEmail(email) || !validation::password(password) ||
        (role != "patient" && role != "expert")) {
        callback(http::error(drogon::k400BadRequest,
            "Use a valid email, a password of 12-72 bytes, and patient or expert role")); return;
    }
    try {
        auto client = DatabaseManager::getInstance().getConnection();
        auto users = client->database("tranquil_talk").collection("users");
        // The unique email index also handles concurrent registrations.
        auto newUser = document{} << "email" << email
            << "emailVerified" << false << "sessionVersion" << 0
            << "password" << BCrypt::generateHash(password, 12)
            << "role" << (role == "expert" ? "expert_pending" : "patient") << finalize;
        users.insert_one(newUser.view());
        Json::Value result;
        result["message"] = role == "expert" ? "Account created. Expert verification is pending." : "Account created. Please sign in.";
        auto response = drogon::HttpResponse::newHttpJsonResponse(result);
        response->setStatusCode(drogon::k201Created);
        callback(response);
    } catch (const mongocxx::operation_exception& e) {
        if (e.code().value() == 11000) {
            callback(http::error(drogon::k409Conflict, "An account with this email already exists"));
        } else callback(http::error(drogon::k503ServiceUnavailable, "Registration is temporarily unavailable"));
    } catch (const std::exception&) {
        callback(http::error(drogon::k503ServiceUnavailable, "Registration is temporarily unavailable"));
    }
}

void UserController::loginUser(const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    if (!rate_limit::allow(req->peerAddr().toIp() + ":login", 10)) {
        callback(http::error(drogon::k429TooManyRequests, "Please try again in a minute")); return;
    }
    auto json = req->getJsonObject();
    if (!json || !json->isObject() || !(*json)["email"].isString() || !(*json)["password"].isString()) {
        callback(http::error(drogon::k400BadRequest, "Email and password are required")); return;
    }
    const auto email = validation::email((*json)["email"].asString());
    const auto password = (*json)["password"].asString();
    if (!validation::validEmail(email) || password.empty() || password.size() > 72 ||
        password.find('\0') != std::string::npos) {
        callback(http::error(drogon::k401Unauthorized, "Invalid credentials")); return;
    }
    try {
        auto client = DatabaseManager::getInstance().getConnection();
        auto users = client->database("tranquil_talk").collection("users");
        auto user = users.find_one(document{} << "email" << email << finalize);
        // A fixed valid dummy hash makes absent-user verification consume bcrypt work too.
        const std::string hash = user ? std::string(user->view()["password"].get_string().value) :
            "$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";
        const bool valid = BCrypt::validatePassword(password, hash);
        if (!user || !valid) {
            callback(http::error(drogon::k401Unauthorized, "Invalid credentials")); return;
        }
        const auto identity = auth::currentIdentity(user->view()["_id"].get_oid().value.to_string());
        const auto& role = identity.role;
        Json::Value result;
        const int version=user->view()["sessionVersion"] ? user->view()["sessionVersion"].get_int32().value : 0;
        result["token"] = auth::issue(identity.id, role, "tranquil-api",60,version);
        result["emailVerified"] = user->view()["emailVerified"] && user->view()["emailVerified"].get_bool().value;
        result["role"] = role;
        result["id"] = identity.id;
        result["expiresIn"] = 3600;
        callback(drogon::HttpResponse::newHttpJsonResponse(result));
    } catch (const std::exception&) {
        callback(http::error(drogon::k503ServiceUnavailable, "Sign in is temporarily unavailable"));
    }
}

void UserController::me(const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    try {
        const auto identity = auth::require(req);
        Json::Value result; result["id"] = identity.id; result["role"] = identity.role;
        auto client=DatabaseManager::getInstance().getConnection();
        auto user=client->database("tranquil_talk").collection("users").find_one(document{} << "_id" << bsoncxx::oid(identity.id) << finalize);
        result["emailVerified"] = user && user->view()["emailVerified"] && user->view()["emailVerified"].get_bool().value;
        result["emailConfigured"] = (std::getenv("RESEND_API_KEY") && std::getenv("MAIL_FROM")) ||
            (std::getenv("MAIL_MODE") && std::string(std::getenv("MAIL_MODE"))=="outbox");
        callback(drogon::HttpResponse::newHttpJsonResponse(result));
    } catch (const auth::Unavailable&) {
        callback(http::error(drogon::k503ServiceUnavailable,"Account access is temporarily unavailable"));
    } catch (const std::exception&) {
        callback(http::error(drogon::k401Unauthorized,"Sign in required"));
    }
}

