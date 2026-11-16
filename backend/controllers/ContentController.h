#pragma once
#include <drogon/HttpController.h>
class ContentController : public drogon::HttpController<ContentController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(ContentController::blogs, "/api/blogs", drogon::Get);
        ADD_METHOD_TO(ContentController::publish, "/api/blogs", drogon::Post);
        ADD_METHOD_TO(ContentController::events, "/api/events", drogon::Get);
    METHOD_LIST_END
    void blogs(const drogon::HttpRequestPtr&, std::function<void(const drogon::HttpResponsePtr&)>&&);
    void publish(const drogon::HttpRequestPtr&, std::function<void(const drogon::HttpResponsePtr&)>&&);
    void events(const drogon::HttpRequestPtr&, std::function<void(const drogon::HttpResponsePtr&)>&&);
};
