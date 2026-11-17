#include "ContentController.h"
#include "../models/DatabaseManager.h"
#include "../utils/Auth.h"
#include "../utils/Http.h"
#include "../utils/RateLimit.h"
#include <mongocxx/client.hpp>
#include <mongocxx/database.hpp>
#include <mongocxx/collection.hpp>
#include <mongocxx/options/find.hpp>
#include <bsoncxx/builder/stream/document.hpp>
#include <bsoncxx/json.hpp>

using namespace bsoncxx::builder::stream;
namespace {
drogon::HttpResponsePtr list(const std::string& name) {
    auto client = DatabaseManager::getInstance().getConnection();
    auto collection = client->database("tranquil_talk").collection(name);
    mongocxx::options::find options;
    options.limit(50);
    options.sort(document{} << std::string(name == "events" ? "startsAt" : "createdAt") << (name == "events" ? 1 : -1) << finalize);
    if (name == "blogs")
        options.projection(document{} << "title" << 1 << "body" << 1 << "author" << 1 << "createdAt" << 1 << "_id" << 1 << finalize);
    else options.projection(document{} << "title" << 1 << "description" << 1 << "startsAt" << 1 << "location" << 1 << "_id" << 0 << finalize);
    auto filter = document{} << finalize;
    // ISO dates are used for events, so filter using the same sortable representation.
    if (name == "events") filter = document{} << "archived" << open_document << "$ne" << true << close_document << "startsAt" << open_document << "$gte"
        << trantor::Date::now().toCustomFormattedString("%Y-%m-%dT%H:%M:%SZ", false)
        << close_document << finalize;
    std::string body = "[";
    bool first = true;
    for (auto&& item : collection.find(filter.view(), options)) {
        if (!first) body += ",";
        body += bsoncxx::to_json(item); first = false;
    }
    auto response = drogon::HttpResponse::newHttpResponse();
    response->setContentTypeCode(drogon::CT_APPLICATION_JSON);
    response->setBody(body + "]");
    return response;
}
}
void ContentController::blogs(const drogon::HttpRequestPtr&,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    try { callback(list("blogs")); }
    catch (const std::exception&) { callback(http::error(drogon::k503ServiceUnavailable, "Articles are temporarily unavailable")); }
}
void ContentController::events(const drogon::HttpRequestPtr&,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    try { callback(list("events")); }
    catch (const std::exception&) { callback(http::error(drogon::k503ServiceUnavailable, "Events are temporarily unavailable")); }
}
void ContentController::publish(const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    auth::Identity identity;
    try { identity = auth::require(req); }
    catch (const auth::Unavailable&) {
        callback(http::error(drogon::k503ServiceUnavailable, "Account access is temporarily unavailable")); return;
    } catch (const std::exception&) {
        callback(http::error(drogon::k401Unauthorized, "Sign in required")); return;
    }
    if (identity.role != "expert") {
        callback(http::error(drogon::k403Forbidden, "Verified expert access required")); return;
    }
    if (!rate_limit::allow(identity.id + ":publish", 5)) {
        callback(http::error(drogon::k429TooManyRequests, "Please try again in a minute")); return;
    }
    auto json = req->getJsonObject();
    if (!json || !json->isObject() || !(*json)["title"].isString() ||
        !(*json)["body"].isString() || !(*json)["author"].isString()) {
        callback(http::error(drogon::k400BadRequest, "Title, article and public author name are required")); return;
    }
    const auto title = (*json)["title"].asString(), body = (*json)["body"].asString(),
               author = (*json)["author"].asString();
    if (title.find_first_not_of(" \r\n\t") == std::string::npos || title.size() > 200 ||
        body.size() < 50 || body.size() > 20000 ||
        author.find_first_not_of(" \r\n\t") == std::string::npos || author.size() > 100) {
        callback(http::error(drogon::k400BadRequest, "Use a title up to 200 bytes, article 50-20000 bytes, and author up to 100 bytes")); return;
    }
    try {
        auto client = DatabaseManager::getInstance().getConnection();
        auto post = document{} << "title" << title << "body" << body << "author" << author
            << "authorId" << identity.id
            << "createdAt" << trantor::Date::now().toCustomFormattedString("%Y-%m-%dT%H:%M:%SZ", false)
            << finalize;
        client->database("tranquil_talk").collection("blogs").insert_one(post.view());
        Json::Value result; result["message"] = "Article published";
        auto response = drogon::HttpResponse::newHttpJsonResponse(result);
        response->setStatusCode(drogon::k201Created); callback(response);
    } catch (const std::exception&) {
        callback(http::error(drogon::k503ServiceUnavailable, "Publishing is temporarily unavailable"));
    }
}
