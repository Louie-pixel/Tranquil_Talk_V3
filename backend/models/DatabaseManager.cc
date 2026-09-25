#include "DatabaseManager.h"
#include <mongocxx/client.hpp>
#include <mongocxx/uri.hpp>
#include <iostream>

DatabaseManager& DatabaseManager::getInstance() {
    static DatabaseManager instance;
    return instance;
}

void DatabaseManager::init(const std::string& uri_str) {
    mongocxx::uri uri(uri_str);
    _pool = std::make_unique<mongocxx::pool>(uri);
    std::cout << "MongoDB connection pool initialized." << std::endl;
}

mongocxx::pool::entry DatabaseManager::getConnection() {
    if (!_pool) {
        throw std::runtime_error("DatabaseManager is not initialized!");
    }
    return _pool->acquire();
}
