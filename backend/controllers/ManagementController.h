#pragma once
#include <drogon/HttpController.h>
class ManagementController : public drogon::HttpController<ManagementController> {
public:
    using Callback=std::function<void(const drogon::HttpResponsePtr&)>;
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(ManagementController::collection,"/api/manage/{1}",drogon::Get,drogon::Post);
    ADD_METHOD_TO(ManagementController::item,"/api/manage/{1}/{2}",drogon::Put,drogon::Delete);
    METHOD_LIST_END
    void collection(const drogon::HttpRequestPtr&,Callback&&,std::string);
    void item(const drogon::HttpRequestPtr&,Callback&&,std::string,std::string);
};
