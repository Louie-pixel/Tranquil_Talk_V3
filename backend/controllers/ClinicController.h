#pragma once
#include <drogon/HttpController.h>

class ClinicController : public drogon::HttpController<ClinicController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(ClinicController::addClinic, "/api/clinics", drogon::Post);
        ADD_METHOD_TO(ClinicController::getNearbyClinics, "/api/clinics", drogon::Get);
    METHOD_LIST_END

    void addClinic(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    void getNearbyClinics(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& callback);
};