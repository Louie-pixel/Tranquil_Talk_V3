#pragma once
#include <drogon/HttpController.h>

class SessionController : public drogon::HttpController<SessionController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(SessionController::create, "/api/sessions", drogon::Post);
    METHOD_LIST_END
    void create(const drogon::HttpRequestPtr&,
                std::function<void(const drogon::HttpResponsePtr&)>&&);
};
