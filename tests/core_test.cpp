#include "../backend/utils/Validation.h"
#include "../backend/utils/RoomRegistry.h"
#include "../backend/utils/RateLimit.h"
#include <cassert>
#include <iostream>
#include <memory>

void invalid(const std::string& value, double min, double max) {
    bool threw = false;
    try { validation::number(value, min, max); } catch (const std::exception&) { threw = true; }
    assert(threw);
}
int main() {
    assert(validation::email("  USER@Example.COM\r\n") == "user@example.com");
    assert(validation::validEmail("user@example.com"));
    assert(!validation::validEmail("user@@example.com"));
    assert(!validation::validEmail("user@example.com."));
    assert(!validation::validEmail("user name@example.com"));
    assert(!validation::validEmail(std::string("user\0@example.com", 17)));
    assert(validation::password("twelve-bytes-password"));
    assert(!validation::password("short"));
    assert(!validation::password(std::string(73, 'a')));
    assert(!validation::password(std::string("twelve\0bytes-password", 21)));
    assert(validation::number("-90", -90, 90) == -90);
    assert(validation::number("0", -180, 180) == 0);
    assert(validation::number("100000", 1, 100000) == 100000);
    for (const auto& value : {"", "abc", "nan", "inf", "1e9999", "90x", "91", "3 "})
        invalid(value, -90, 90);
    invalid("-181", -180, 180);
    invalid("0", 1, 100000);
    RoomRegistry<int> rooms;
    assert(rooms.join("private-a", 1));
    assert(rooms.join("private-a", 1));
    assert(rooms.join("private-a", 2));
    assert(!rooms.join("private-a", 3));
    assert(!rooms.join("private-b", 1));
    assert(rooms.peers("private-a", 3).empty());
    assert(rooms.peers("does-not-exist", 1).empty());
    assert(rooms.peers("private-a", 1) == std::vector<int>{2});
    assert(rooms.size() == 1);
    assert(rooms.leave(1) == std::vector<int>{2});
    assert(rooms.leave(2).empty());
    assert(rooms.size() == 0);
    for (int i = 0; i < 1000; ++i) assert(rooms.join(std::to_string(i), i));
    assert(!rooms.join("over-capacity", 1001));
    rooms.leave(0);
    assert(rooms.join("reclaimed", 1001));
    assert(rate_limit::allow("test", 2));
    assert(rate_limit::allow("test", 2));
    assert(!rate_limit::allow("test", 2));
    std::cout << "Core validation, room isolation/capacity/cleanup and rate-limit tests passed.\n";
}
