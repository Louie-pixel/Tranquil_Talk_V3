#pragma once
#include <mongocxx/instance.hpp>
#include <mongocxx/pool.hpp>
#include <memory>
#include <string>

class DatabaseManager {
public:
    static DatabaseManager& getInstance();
    void init(const std::string& uri);
    mongocxx::pool::entry getConnection();

private:
    DatabaseManager() = default;
    ~DatabaseManager() = default;
    DatabaseManager(const DatabaseManager&) = delete;
    DatabaseManager& operator=(const DatabaseManager&) = delete;

    mongocxx::instance _instance{};
    std::unique_ptr<mongocxx::pool> _pool;
};
