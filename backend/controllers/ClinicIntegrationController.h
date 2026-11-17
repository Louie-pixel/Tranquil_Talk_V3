#pragma once
#include <drogon/HttpController.h>
class ClinicIntegrationController : public drogon::HttpController<ClinicIntegrationController> {
public:
    using Callback=std::function<void(const drogon::HttpResponsePtr&)>;
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(ClinicIntegrationController::preview,"/api/admin/clinics/osm-preview",drogon::Post);
    ADD_METHOD_TO(ClinicIntegrationController::importClinics,"/api/admin/clinics/import",drogon::Post);
    METHOD_LIST_END
    void preview(const drogon::HttpRequestPtr&,Callback&&);
    void importClinics(const drogon::HttpRequestPtr&,Callback&&);
};
