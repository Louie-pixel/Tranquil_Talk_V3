#include "DatabaseManager.h"
#include <mongocxx/client.hpp>
#include <mongocxx/database.hpp>
#include <mongocxx/collection.hpp>
#include <mongocxx/uri.hpp>
#include <mongocxx/options/index.hpp>
#include <bsoncxx/builder/stream/document.hpp>
#include <stdexcept>

DatabaseManager& DatabaseManager::getInstance() {
    static DatabaseManager instance;
    return instance;
}

void DatabaseManager::init(const std::string& uri) {
    _pool = std::make_unique<mongocxx::pool>(mongocxx::uri(uri));
    auto connection = getConnection();
    auto db = connection->database("tranquil_talk");
    using namespace bsoncxx::builder::stream;
    mongocxx::options::index unique;
    unique.unique(true);
    db.collection("users").create_index(document{} << "email" << 1 << finalize, unique);
    db.collection("clinics").create_index(document{} << "location" << "2dsphere" << finalize);
}

mongocxx::pool::entry DatabaseManager::getConnection() {
    if (!_pool) throw std::runtime_error("Database is not initialized");
    return _pool->acquire();
}
