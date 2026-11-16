#pragma once
#include <algorithm>
#include <string>
#include <unordered_map>
#include <vector>

// Caller holds the signaling mutex. No room IDs or connection identities are logged.
template<class Connection>
class RoomRegistry {
    std::unordered_map<std::string, std::vector<Connection>> rooms_;
public:
    bool join(const std::string& room, const Connection& connection) {
        for (const auto& entry : rooms_) {
            const auto& members = entry.second;
            if (std::find(members.begin(), members.end(), connection) != members.end())
                return entry.first == room; // duplicate joins are idempotent; no room switching
        }
        auto it = rooms_.find(room);
        if (it == rooms_.end()) {
            if (rooms_.size() >= 1000) return false;
            it = rooms_.emplace(room, std::vector<Connection>{}).first;
        }
        if (it->second.size() >= 2) return false;
        it->second.push_back(connection);
        return true;
    }
    std::vector<Connection> peers(const std::string& room, const Connection& sender) const {
        auto it = rooms_.find(room);
        if (it == rooms_.end() ||
            std::find(it->second.begin(), it->second.end(), sender) == it->second.end())
            return {};
        std::vector<Connection> result;
        for (const auto& member : it->second) if (member != sender) result.push_back(member);
        return result;
    }
    std::vector<Connection> leave(const Connection& connection) {
        std::vector<Connection> peers;
        for (auto it = rooms_.begin(); it != rooms_.end();) {
            auto& members = it->second;
            const auto found = std::find(members.begin(), members.end(), connection);
            if (found != members.end()) {
                members.erase(found);
                peers = members;
            }
            if (members.empty()) it = rooms_.erase(it); else ++it;
        }
        return peers;
    }
    std::size_t size() const { return rooms_.size(); }
};
