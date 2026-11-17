#include "ClinicController.h"
#include "../models/DatabaseManager.h"
#include "../utils/Auth.h"
#include "../utils/Http.h"
#include "../utils/Validation.h"
#include "../utils/Workflow.h"
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
        workflow::verified(client->database("tranquil_talk"),identity);
        auto clinics = client->database("tranquil_talk").collection("clinics");
        Json::Value record;record["name"]=name;record["location"]["type"]="Point";
        record["ownerId"]=identity.id;record["revision"]=1;record["createdAt"]=workflow::now();record["updatedAt"]=workflow::now();record["archived"]=false;
        record["location"]["coordinates"][0]=lng;record["location"]["coordinates"][1]=lat;
        for(const auto* field:{"address","suburb","city","country","phone","website"}) {
            if(json->isMember(field)) {
                if(!(*json)[field].isString() || !experts::clean((*json)[field].asString(),std::string(field)=="website" ? 512 : 240)) {
                    callback(http::error(drogon::k400BadRequest,"Clinic contact details must be bounded text"));return;
                }
                record[field]=experts::trim((*json)[field].asString());
            }
        }
        if(!record.get("website","").asString().empty() && !experts::httpsUrl(record["website"].asString())) {
            callback(http::error(drogon::k400BadRequest,"Clinic websites must use HTTPS"));return;
        }
        auto clinic=workflow::bson(record);
        clinics.insert_one(clinic.view());
        Json::Value result; result["message"] = "Clinic added";
        auto response = drogon::HttpResponse::newHttpJsonResponse(result);
        response->setStatusCode(drogon::k201Created);
        callback(response);
    } catch (const workflow::Error& e) {
        callback(http::error(e.code,e.what()));
    } catch (const std::exception&) {
        callback(http::error(drogon::k503ServiceUnavailable, "Clinic service is temporarily unavailable"));
    }
}

void ClinicController::getNearbyClinics(const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    double lat=0, lng=0, radius=25000;
    const auto queryText=experts::trim(req->getParameter("q"));
    const bool nearby=!req->getParameter("lat").empty() || !req->getParameter("lng").empty();
    try {
        if(!queryText.empty() && (queryText.size()<2 || !experts::clean(queryText,100)))throw std::invalid_argument("Invalid search");
        if(nearby) {
            lat = validation::number(req->getParameter("lat"), -90, 90);
            lng = validation::number(req->getParameter("lng"), -180, 180);
            if(!req->getParameter("radius").empty())radius = validation::number(req->getParameter("radius"), 1, 100000);
        } else if(queryText.empty() || !req->getParameter("radius").empty())throw std::invalid_argument("Choose an area");
    } catch (const std::exception&) {
        callback(http::error(drogon::k400BadRequest,
            "Enter an area or clinic name, or provide a valid location")); return;
    }
    try {
        auto client = DatabaseManager::getInstance().getConnection();
        auto clinics = client->database("tranquil_talk").collection("clinics");
        Json::Value filter(Json::objectValue);
        filter["archived"]["$ne"]=true;
        if(nearby) {
            auto& near=filter["location"]["$near"];
            near["$geometry"]["type"]="Point";near["$geometry"]["coordinates"][0]=lng;
            near["$geometry"]["coordinates"][1]=lat;near["$maxDistance"]=radius;
        }
        if(!queryText.empty()) {
            for(const auto* field:{"name","address","suburb","city","country"}) {
                Json::Value clause;clause[field]["$regex"]=experts::escapeRegex(queryText);clause[field]["$options"]="i";filter["$or"].append(clause);
            }
        }
        auto query=workflow::bson(filter);
        mongocxx::options::find options;
        options.limit(100);
        // Return only public fields, never arbitrary database documents.
        options.projection(document{} << "name" << 1 << "location" << 1 << "address" << 1 << "suburb" << 1
            << "city" << 1 << "country" << 1 << "phone" << 1 << "website" << 1 << "_id" << 0 << finalize);
        if(!nearby)options.sort(document{} << "name" << 1 << finalize);
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
void ClinicController::status(const drogon::HttpRequestPtr&,std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    Json::Value result;result["mode"]="application";callback(drogon::HttpResponse::newHttpJsonResponse(result));
}
