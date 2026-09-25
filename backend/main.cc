#include <drogon/drogon.h>
#include <iostream>
#include "models/DatabaseManager.h"

int main() {
    std::cout << "Starting Tranquil Talk Server..." << std::endl;
    
    try {
        DatabaseManager::getInstance().init("mongodb://localhost:27017");
    } catch (const std::exception& e) {
        std::cerr << "Failed to connect to MongoDB: " << e.what() << std::endl;
        return 1;
    }
    
    drogon::app().loadConfigFile("config.json");
    
    drogon::app().registerHandler(
        "/api/health",
        [](const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k200OK);
            resp->setContentTypeCode(drogon::CT_APPLICATION_JSON);
            resp->setBody(R"({"status": "success", "message": "Tranquil Talk API and MongoDB are ready!"})");
            callback(resp);
        },
        {drogon::Get}
    );

    drogon::app().run();
    return 0;
}
