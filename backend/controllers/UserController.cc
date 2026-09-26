#include "UserController.h"
#include "../models/DatabaseManager.h"
#include <mongocxx/client.hpp>
#include <mongocxx/database.hpp>
#include <mongocxx/collection.hpp>
#include <bsoncxx/builder/stream/document.hpp>
#include <bsoncxx/json.hpp>
#include <jwt-cpp/jwt.h>
#include <bcrypt/BCrypt.hpp> // Our new library

using namespace bsoncxx::builder::stream;

void UserController::registerUser(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    auto json = req->getJsonObject();
    if (!json || !(*json)["email"].isString() || !(*json)["password"].isString() || !(*json)["role"].isString()) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setStatusCode(drogon::k400BadRequest);
        resp->setBody("Missing required fields");
        callback(resp);
        return;
    }

    std::string email = (*json)["email"].asString();
    std::string raw_password = (*json)["password"].asString();
    std::string role = (*json)["role"].asString();

    try {
        auto client = DatabaseManager::getInstance().getConnection();
        auto collection = client->database("tranquil_talk").collection("users");
        auto existing_user = collection.find_one(document{} << "email" << email << finalize);
        
        if (existing_user) {
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k409Conflict);
            resp->setBody("User already exists");
            callback(resp);
            return;
        }

        // HASH THE PASSWORD (Automatically handles salting internally)
        std::string hashed_password = BCrypt::generateHash(raw_password);

        bsoncxx::document::value new_user = document{} 
            << "email" << email 
            << "password" << hashed_password 
            << "role" << role 
            << finalize;
            
        collection.insert_one(new_user.view());
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setStatusCode(drogon::k201Created);
        resp->setBody("User registered securely!");
        callback(resp);
    } catch (const std::exception& e) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setStatusCode(drogon::k500InternalServerError);
        resp->setBody(std::string("Database error: ") + e.what());
        callback(resp);
    }
}

void UserController::loginUser(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    auto json = req->getJsonObject();
    if (!json || !(*json)["email"].isString() || !(*json)["password"].isString()) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setStatusCode(drogon::k400BadRequest);
        resp->setBody("Missing credentials");
        callback(resp);
        return;
    }

    std::string email = (*json)["email"].asString();
    std::string raw_password = (*json)["password"].asString();

    try {
        auto client = DatabaseManager::getInstance().getConnection();
        auto collection = client->database("tranquil_talk").collection("users");
        auto user = collection.find_one(document{} << "email" << email << finalize);

        if (!user) {
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k401Unauthorized);
            resp->setBody("Invalid credentials");
            callback(resp);
            return;
        }

        // VERIFY THE BCRYPT HASH
        std::string db_hash(user->view()["password"].get_string().value);
        if (!BCrypt::validatePassword(raw_password, db_hash)) {
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k401Unauthorized);
            resp->setBody("Invalid credentials");
            callback(resp);
            return;
        }

        std::string role(user->view()["role"].get_string().value);
        auto token = jwt::create()
            .set_issuer("tranquil_talk")
            .set_type("JWS")
            .set_payload_claim("email", jwt::claim(email))
            .set_payload_claim("role", jwt::claim(role))
            .sign(jwt::algorithm::hs256{"super_secret_key_change_me"}); // Consider pulling this key from an env variable later!

        Json::Value ret;
        ret["token"] = token;
        ret["role"] = role;
        auto resp = drogon::HttpResponse::newHttpJsonResponse(ret);
        callback(resp);
    } catch (const std::exception& e) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setStatusCode(drogon::k500InternalServerError);
        resp->setBody(std::string("Database error: ") + e.what());
        callback(resp);
    }
}
