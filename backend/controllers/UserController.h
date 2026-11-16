#pragma once
#include <drogon/HttpController.h>

class UserController : public drogon::HttpController<UserController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(UserController::registerUser, "/api/register", drogon::Post);
        ADD_METHOD_TO(UserController::loginUser, "/api/login", drogon::Post);
        ADD_METHOD_TO(UserController::me, "/api/me", drogon::Get);
    METHOD_LIST_END

    void me(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    void registerUser(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    void loginUser(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& callback);
};
