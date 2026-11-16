#pragma once
#include <drogon/HttpController.h>
class WorkflowController : public drogon::HttpController<WorkflowController> {
public:
    using Callback=std::function<void(const drogon::HttpResponsePtr&)>;
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(WorkflowController::availability,"/api/availability/{1}",drogon::Get,drogon::Post);
    ADD_METHOD_TO(WorkflowController::appointments,"/api/appointments",drogon::Get,drogon::Post);
    ADD_METHOD_TO(WorkflowController::appointmentAction,"/api/appointments/{1}/{2}",drogon::Post);
    ADD_METHOD_TO(WorkflowController::accountAction,"/api/account/{1}",drogon::Post);
    ADD_METHOD_TO(WorkflowController::reports,"/api/reports",drogon::Get,drogon::Post);
    ADD_METHOD_TO(WorkflowController::reviewReport,"/api/reports/{1}",drogon::Post);
    ADD_METHOD_TO(WorkflowController::rtcConfig,"/api/rtc-config",drogon::Get);
    METHOD_LIST_END
    void availability(const drogon::HttpRequestPtr&,Callback&&,std::string);
    void appointments(const drogon::HttpRequestPtr&,Callback&&);
    void appointmentAction(const drogon::HttpRequestPtr&,Callback&&,std::string,std::string);
    void accountAction(const drogon::HttpRequestPtr&,Callback&&,std::string);
    void reports(const drogon::HttpRequestPtr&,Callback&&);
    void reviewReport(const drogon::HttpRequestPtr&,Callback&&,std::string);
    void rtcConfig(const drogon::HttpRequestPtr&,Callback&&);
};
