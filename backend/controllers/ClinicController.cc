#include "ClinicController.h"
#include "../models/DatabaseManager.h"
#include "../utils/Auth.h"
#include "../utils/Http.h"
#include "../utils/Validation.h"
#include <bsoncxx/builder/stream/document.hpp>
#include <bsoncxx/json.hpp>
#include <mongocxx/options/find.hpp>
#include <mongocxx/client.hpp>
#include <mongocxx/database.hpp>
#include <mongocxx/collection.hpp>
#include <cmath>

using namespace bsoncxx::builder::stream;

void ClinicController::addClinic(const drogon::HttpRequestPtr& req,
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
    auto json = req->getJsonObject();
    if (!json || !json->isObject() || !(*json)["name"].isString() ||
        !(*json)["lat"].isNumeric() || !(*json)["lng"].isNumeric()) {
        callback(http::error(drogon::k400BadRequest, "Name, latitude and longitude are required")); return;
    }
    const auto name = (*json)["name"].asString();
    const double lat = (*json)["lat"].asDouble(), lng = (*json)["lng"].asDouble();
    if (name.find_first_not_of(" \t\r\n") == std::string::npos || name.size() > 200 ||
        !std::isfinite(lat) || !std::isfinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        callback(http::error(drogon::k400BadRequest, "Invalid clinic name or coordinates")); return;
    }
    try {
        auto client = DatabaseManager::getInstance().getConnection();
        auto clinics = client->database("tranquil_talk").collection("clinics");
        auto clinic = document{} << "name" << name
            << "location" << open_document << "type" << "Point"
                << "coordinates" << open_array << lng << lat << close_array
            << close_document << finalize;
        clinics.insert_one(clinic.view());
        Json::Value result; result["message"] = "Clinic added";
        auto response = drogon::HttpResponse::newHttpJsonResponse(result);
        response->setStatusCode(drogon::k201Created);
        callback(response);
    } catch (const std::exception&) {
        callback(http::error(drogon::k503ServiceUnavailable, "Clinic service is temporarily unavailable"));
    }
}

void ClinicController::getNearbyClinics(const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    double lat, lng, radius;
    try {
        lat = validation::number(req->getParameter("lat"), -90, 90);
        lng = validation::number(req->getParameter("lng"), -180, 180);
        radius = validation::number(req->getParameter("radius"), 1, 100000);
    } catch (const std::exception&) {
        callback(http::error(drogon::k400BadRequest,
            "Use latitude -90..90, longitude -180..180 and radius 1..100000 metres")); return;
    }
    try {
        auto client = DatabaseManager::getInstance().getConnection();
        auto clinics = client->database("tranquil_talk").collection("clinics");
        auto query = document{} << "location" << open_document << "$near" << open_document
            << "$geometry" << open_document << "type" << "Point"
                << "coordinates" << open_array << lng << lat << close_array << close_document
            << "$maxDistance" << radius << close_document << close_document << finalize;
        mongocxx::options::find options;
        options.limit(100);
        // Return only public fields, never arbitrary database documents.
        options.projection(document{} << "name" << 1 << "location" << 1 << "_id" << 0 << finalize);
        std::string body = "[";
        bool first = true;
        for (auto&& clinic : clinics.find(query.view(), options)) {
            if (!first) body += ",";
            body += bsoncxx::to_json(clinic); first = false;
        }
        body += "]";
        auto response = drogon::HttpResponse::newHttpResponse();
        response->setContentTypeCode(drogon::CT_APPLICATION_JSON);
        response->setBody(body);
        callback(response);
    } catch (const std::exception&) {
        callback(http::error(drogon::k503ServiceUnavailable, "Clinic search is temporarily unavailable"));
    }
}
