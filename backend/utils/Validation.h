#pragma once
#include <algorithm>
#include <cctype>
#include <cmath>
#include <stdexcept>
#include <string>

namespace validation {
inline std::string email(std::string value) {
    const auto first = value.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    value = value.substr(first, value.find_last_not_of(" \t\r\n") - first + 1);
    std::transform(value.begin(), value.end(), value.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return value;
}
inline bool validEmail(const std::string& value) {
    const auto at = value.find('@');
    return value.size() <= 254 && at != std::string::npos && at > 0 &&
           value.find('@', at + 1) == std::string::npos &&
           value.find('.', at + 2) != std::string::npos &&
           value.back() != '.' && value.find_first_of(" \t\r\n\0", 0, 5) == std::string::npos;
}
inline bool password(const std::string& value) {
    return value.size() >= 12 && value.size() <= 72 && value.find('\0') == std::string::npos;
}
inline double number(const std::string& value, double min, double max) {
    std::size_t used = 0;
    const double result = std::stod(value, &used);
    if (used != value.size() || !std::isfinite(result) || result < min || result > max)
        throw std::invalid_argument("Number outside supported range");
    return result;
}
}
