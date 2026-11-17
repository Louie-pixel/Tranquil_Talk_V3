#pragma once
#include <drogon/HttpController.h>
class PreferencesController : public drogon::HttpController<PreferencesController> {
public:
    using Callback=std::function<void(const drogon::HttpResponsePtr&)>;
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(PreferencesController::preferences,"/api/account/preferences",drogon::Get,drogon::Put);
    ADD_METHOD_TO(PreferencesController::zones,"/api/timezones",drogon::Get);
    ADD_METHOD_TO(PreferencesController::operations,"/api/admin/operations",drogon::Get);
    ADD_METHOD_TO(PreferencesController::retryMail,"/api/admin/mail/retry",drogon::Post);
    ADD_METHOD_TO(PreferencesController::scheduleReminders,"/api/admin/mail/schedule-reminders",drogon::Post);
    METHOD_LIST_END
    void preferences(const drogon::HttpRequestPtr&,Callback&&);
    void zones(const drogon::HttpRequestPtr&,Callback&&);
    void operations(const drogon::HttpRequestPtr&,Callback&&);
    void retryMail(const drogon::HttpRequestPtr&,Callback&&);
    void scheduleReminders(const drogon::HttpRequestPtr&,Callback&&);
};
