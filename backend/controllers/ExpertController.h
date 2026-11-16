#pragma once
#include <drogon/HttpController.h>

class ExpertController : public drogon::HttpController<ExpertController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(ExpertController::directory, "/api/experts", drogon::Get);
        ADD_METHOD_TO(ExpertController::detail, "/api/experts/{1}", drogon::Get);
        ADD_METHOD_TO(ExpertController::mine, "/api/expert-profile", drogon::Get);
        ADD_METHOD_TO(ExpertController::save, "/api/expert-profile", drogon::Put);
        ADD_METHOD_TO(ExpertController::submit, "/api/expert-profile/submit", drogon::Post);
        ADD_METHOD_TO(ExpertController::queue, "/api/admin/experts", drogon::Get);
        ADD_METHOD_TO(ExpertController::review, "/api/admin/experts/{1}/review", drogon::Post);
    METHOD_LIST_END
    using Callback = std::function<void(const drogon::HttpResponsePtr&)>;
    void directory(const drogon::HttpRequestPtr&, Callback&&);
    void detail(const drogon::HttpRequestPtr&, Callback&&, std::string);
    void mine(const drogon::HttpRequestPtr&, Callback&&);
    void save(const drogon::HttpRequestPtr&, Callback&&);
    void submit(const drogon::HttpRequestPtr&, Callback&&);
    void queue(const drogon::HttpRequestPtr&, Callback&&);
    void review(const drogon::HttpRequestPtr&, Callback&&, std::string);
};
