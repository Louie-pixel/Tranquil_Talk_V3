#include "ClinicController.h"
#include "../models/DatabaseManager.h"
#include <mongocxx/client.hpp>
#include <mongocxx/database.hpp>
#include <mongocxx/collection.hpp>
#include <bsoncxx/builder/stream/document.hpp>
#include <bsoncxx/json.hpp>

using namespace bsoncxx::builder::stream;

void ClinicController::addClinic(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    auto json = req->getJsonObject();
    if (!json || !(*json)["name"].isString() || !(*json)["lat"].isDouble() || !(*json)["lng"].isDouble()) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setStatusCode(drogon::k400BadRequest);
        resp->setBody("Missing required fields (name, lat, lng)");
        callback(resp);
        return;
    }

    std::string name = (*json)["name"].asString();
    double lat = (*json)["lat"].asDouble();
    double lng = (*json)["lng"].asDouble();

    try {
        auto client = DatabaseManager::getInstance().getConnection();
        auto db = client->database("tranquil_talk");
        auto collection = db.collection("clinics");
        
        // MongoDB strictly requires GeoJSON coordinate arrays to be [longitude, latitude]
        bsoncxx::document::value new_clinic = document{} 
            << "name" << name 
            << "location" << open_document
                << "type" << "Point"
                << "coordinates" << open_array << lng << lat << close_array
            << close_document
            << finalize;
            
        collection.insert_one(new_clinic.view());

        // Automatically ensure the 2dsphere index exists upon creation
        bsoncxx::document::value index_spec = document{} << "location" << "2dsphere" << finalize;
        collection.create_index(index_spec.view());

        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setStatusCode(drogon::k201Created);
        resp->setBody("Clinic seeded successfully and 2dsphere index verified!");
        callback(resp);
    } catch (const std::exception& e) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setStatusCode(drogon::k500InternalServerError);
        resp->setBody(std::string("Database error: ") + e.what());
        callback(resp);
    }
}

void ClinicController::getNearbyClinics(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    auto lat_str = req->getParameter("lat");
    auto lng_str = req->getParameter("lng");
    auto radius_str = req->getParameter("radius");

    if (lat_str.empty() || lng_str.empty() || radius_str.empty()) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setStatusCode(drogon::k400BadRequest);
        resp->setBody("Missing query parameters: lat, lng, radius");
        callback(resp);
        return;
    }

    double lat = std::stod(lat_str);
    double lng = std::stod(lng_str);
    double max_distance = std::stod(radius_str); // Searched radius in meters

    try {
        auto client = DatabaseManager::getInstance().getConnection();
        auto collection = client->database("tranquil_talk").collection("clinics");

        // Execute the geospatial $near search
        auto query = document{} 
            << "location" << open_document
                << "$near" << open_document
                    << "$geometry" << open_document
                        << "type" << "Point"
                        << "coordinates" << open_array << lng << lat << close_array
                    << close_document
                    << "$maxDistance" << max_distance
                << close_document
            << close_document 
            << finalize;

        auto cursor = collection.find(query.view());
        
        // Stream the BSON results directly into a valid JSON array
        std::string response_body = "[";
        bool first = true;
        for (auto&& doc : cursor) {
            if (!first) response_body += ",";
            response_body += bsoncxx::to_json(doc);
            first = false;
        }
        response_body += "]";

        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setContentTypeCode(drogon::CT_APPLICATION_JSON);
        resp->setBody(response_body);
        callback(resp);
    } catch (const std::exception& e) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setStatusCode(drogon::k500InternalServerError);
        resp->setBody(std::string("Database error: ") + e.what());
        callback(resp);
    }
}
