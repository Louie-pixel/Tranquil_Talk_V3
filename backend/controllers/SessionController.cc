#include "SessionController.h"
#include "../utils/Auth.h"
#include "../utils/Http.h"
#include "../utils/RateLimit.h"

void SessionController::create(const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    auth::Identity identity;
    try { identity = auth::require(req); }
    catch (const std::exception&) {
        callback(http::error(drogon::k401Unauthorized, "Sign in required")); return;
    }
    if (!rate_limit::allow(identity.id + ":room", 5)) {
        callback(http::error(drogon::k429TooManyRequests, "Please try again in a minute")); return;
    }
    const auto room = drogon::utils::getUuid();
    Json::Value result;
    result["roomId"] = room;
    // A capability token identifies only a room, never the account or email.
    result["ticket"] = auth::issue(room, "participant", "tranquil-room", 30);
    result["expiresIn"] = 1800;
    auto response = drogon::HttpResponse::newHttpJsonResponse(result);
    response->setStatusCode(drogon::k201Created);
    callback(response);
}
