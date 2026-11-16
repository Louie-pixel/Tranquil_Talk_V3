#pragma once
#include <chrono>
#include <mutex>
#include <string>
#include <unordered_map>

namespace rate_limit {
// Bounded, process-local limiter. Use a shared edge limiter for multi-instance deployments.
inline bool allow(const std::string& key, unsigned limit = 20) {
    using Clock = std::chrono::steady_clock;
    struct Bucket { Clock::time_point start; unsigned count; };
    static std::mutex mutex;
    static std::unordered_map<std::string, Bucket> buckets;
    const auto now = Clock::now();
    std::lock_guard<std::mutex> lock(mutex);
    for (auto it = buckets.begin(); it != buckets.end();) {
        if (now - it->second.start >= std::chrono::minutes(1)) it = buckets.erase(it);
        else ++it;
    }
    auto it = buckets.find(key);
    if (it == buckets.end()) {
        if (buckets.size() >= 10000) return false;
        it = buckets.emplace(key, Bucket{now, 0}).first;
    }
    return ++it->second.count <= limit;
}
}
