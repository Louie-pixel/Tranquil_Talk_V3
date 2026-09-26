#include <drogon/drogon.h>
#include <mongocxx/instance.hpp>
#include "models/DatabaseManager.h"
#include <iostream>

int main() {
    std::cout << "Starting Tranquil Talk Server..." << std::endl;
    
    // The MongoDB driver must be initialized globally once before any DB operations
    
    try {
        DatabaseManager::getInstance().init("mongodb://localhost:27017");
        std::cout << "MongoDB connection initialized successfully." << std::endl;
    } catch (const std::exception& e) {
        std::cerr << "Failed to connect to MongoDB: " << e.what() << std::endl;
        return 1;
    }

    // Configure Drogon to listen on all interfaces at port 8080
    drogon::app().addListener("0.0.0.0", 8080);
    drogon::app().run();
    
    return 0;
}