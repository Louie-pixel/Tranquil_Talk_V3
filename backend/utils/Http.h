#pragma once
#include <drogon/drogon.h>
namespace http {
inline drogon::HttpResponsePtr error(drogon::HttpStatusCode status, const std::string& message) {
    Json::Value body;
    body["error"] = message;
    auto response = drogon::HttpResponse::newHttpJsonResponse(body);
    response->setStatusCode(status);
    return response;
}
}
