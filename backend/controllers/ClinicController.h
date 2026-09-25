#pragma once
#include <drogon/HttpController.h>

class ClinicController : public drogon::HttpController<ClinicController> {
public:
    METHOD_LIST_BEGIN
    // Explicitly map the full paths inside the method list macros
    METHOD_ADD(ClinicController::getNearbyClinics, "/api/clinics", drogon::Get);
    METHOD_ADD(ClinicController::addClinic, "/api/clinics", drogon::Post);
    METHOD_LIST_END

    void getNearbyClinics(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    void addClinic(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& callback);
};
