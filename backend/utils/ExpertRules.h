#pragma once
#include <algorithm>
#include <regex>
#include <string>
#include <vector>

namespace experts {
inline const std::vector<std::string>& specialties() {
    static const std::vector<std::string> values = {
        "Anxiety", "Stress", "Burnout", "Trauma", "Relationships", "Grief",
        "Depression", "Youth support", "General wellbeing"
    };
    return values;
}
inline bool contains(const std::vector<std::string>& values, const std::string& value) {
    return std::find(values.begin(), values.end(), value) != values.end();
}
inline std::string trim(const std::string& value) {
    const auto first = value.find_first_not_of(" \t\r\n");
    return first == std::string::npos ? "" : value.substr(first, value.find_last_not_of(" \t\r\n") - first + 1);
}
inline bool clean(const std::string& value, std::size_t max) {
    if (value.size() > max) return false;
    return std::none_of(value.begin(), value.end(), [](unsigned char c) {
        return c < 32 && c != '\n' && c != '\r' && c != '\t';
    });
}
inline bool httpsUrl(const std::string& value) {
    static const std::regex pattern(R"(^https://[A-Za-z0-9][A-Za-z0-9.-]*(?::[0-9]{1,5})?(?:[/?#][^\s\\]*)?$)");
    return value.size() <= 512 && std::regex_match(value, pattern);
}
inline std::string escapeRegex(const std::string& value) {
    const std::string metacharacters = R"(\.^$|()[]{}*+?)";
    std::string escaped;
    for (const char c : value) {
        if (metacharacters.find(c) != std::string::npos) escaped += '\\';
        escaped += c;
    }
    return escaped;
}
inline bool canSubmit(const std::string& status) {
    return status == "draft" || status == "changes_requested";
}
inline bool canReview(const std::string& status, const std::string& action) {
    if (action == "approve") return status == "pending";
    if (action == "request_changes")
        return status == "pending" || status == "approved" || status == "suspended";
    if (action == "suspend")
        return status == "draft" || status == "pending" || status == "approved" || status == "changes_requested";
    return false;
}
inline bool approved(const std::string& status, int revision, int approvedRevision) {
    return status == "approved" && revision > 0 && revision == approvedRevision;
}
}
