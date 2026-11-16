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
    db.collection("expert_profiles").create_index(document{} << "status" << 1 << "updatedAt" << -1 << finalize);
    db.collection("expert_profiles").create_index(document{} << "status" << 1 << "name" << 1 << "_id" << 1 << finalize);
    db.collection("availability").create_index(document{} << "expertId" << 1 << "startAt" << 1 << finalize);
    db.collection("appointments").create_index(document{} << "patientId" << 1 << "startAt" << 1 << finalize);
    db.collection("appointments").create_index(document{} << "expertId" << 1 << "startAt" << 1 << finalize);
    db.collection("reservations").create_index(document{} << "appointmentId" << 1 << finalize);
    db.collection("account_actions").create_index(document{} << "hash" << 1 << finalize);
    db.collection("mail_outbox").create_index(document{} << "state" << 1 << "nextAttempt" << 1 << finalize);
    db.collection("reports").create_index(document{} << "status" << 1 << "createdAt" << 1 << finalize);
}

mongocxx::pool::entry DatabaseManager::getConnection() {
    if (!_pool) throw std::runtime_error("Database is not initialized");
    return _pool->acquire();
}

