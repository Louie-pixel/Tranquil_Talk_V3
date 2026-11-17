#include "PreferencesController.h"
#include "../utils/Timezones.h"
#include "../utils/AppointmentMail.h"
#include "../utils/RateLimit.h"
using namespace workflow;
void PreferencesController::preferences(const drogon::HttpRequestPtr& req,Callback&& cb){
    respond(std::move(cb),[&]{
        auto who=auth::require(req);auto c=DatabaseManager::getInstance().getConnection();auto db=c->database("tranquil_talk");
        auto u=find(db["users"],objectId(who.id));
        if(req->method()==drogon::Put){
            auto b=body(req);ensure(!b.empty(),"Send the preferences you want to change");
            for(const auto& name:b.getMemberNames())ensure(name=="timeZone" || name=="appointmentEmails" || name=="appointmentReminders","Unknown preference");
            if(b.isMember("timeZone"))timezones::validate(text(b,"timeZone",1,99));
            for(const auto* f:{"appointmentEmails","appointmentReminders"})ensure(!b.isMember(f) || b[f].isBool(),"Email preferences must be booleans");
            auto s=c->start_session();s.with_transaction([&](mongocxx::client_session* session){
                u=find(db["users"],objectId(who.id),session);ensure(!u.isNull() && !u.get("disabled",false).asBool() && !u.get("deleted",false).asBool(),"Account unavailable",drogon::k403Forbidden);
                for(const auto& f:b.getMemberNames())u[f]=b[f];
                u["workflowFence"]=drogon::utils::getUuid();replace(db["users"],objectId(who.id),u,session);
                if(b.isMember("appointmentEmails") || b.isMember("appointmentReminders")){
                    Json::Value q;q["$or"][0]["patientId"]=who.id;q["$or"][1]["expertId"]=who.id;q["status"]="accepted";q["startAt"]["$gt"]=now();auto filter=bson(q);
                    for(auto raw:db["appointments"].find(*session,filter.view()))appointment_mail::schedule(db,session,decode(raw),who.id,false);
                }
            });
        }
        Json::Value result;result["timeZone"]=timezones::forUser(u);result["appointmentEmails"]=u.get("appointmentEmails",true);result["appointmentReminders"]=u.get("appointmentReminders",true);
        result["serverNow"]=now();return result;
    });
}
void PreferencesController::zones(const drogon::HttpRequestPtr&,Callback&& cb){
    respond(std::move(cb),[]{
        UErrorCode error=U_ZERO_ERROR;std::unique_ptr<UEnumeration,decltype(&uenum_close)> zones(ucal_openTimeZones(&error),uenum_close);
        ensure(U_SUCCESS(error),"Timezone list unavailable",drogon::k503ServiceUnavailable);
        Json::Value out;out["items"]=Json::Value(Json::arrayValue);int32_t length=0;
        while(const char* zone=uenum_next(zones.get(),&length,&error)){if(std::string(zone,length)!="Etc/Unknown")out["items"].append(std::string(zone,length));}
        ensure(U_SUCCESS(error),"Timezone list unavailable",drogon::k503ServiceUnavailable);return out;
    });
}
void PreferencesController::operations(const drogon::HttpRequestPtr& req,Callback&& cb){
    respond(std::move(cb),[&]{
        auto who=auth::require(req);ensure(who.role=="admin","Administrator access required",drogon::k403Forbidden);
        auto c=DatabaseManager::getInstance().getConnection();auto db=c->database("tranquil_talk");verified(db,who);
        Json::Value pending;pending["state"]="pending";Json::Value failed;failed["state"]="failed";
        auto p=bson(pending),f=bson(failed);Json::Value out;
        out["pendingMail"]=Json::Int64(db["mail_outbox"].count_documents(p.view()));out["failedMail"]=Json::Int64(db["mail_outbox"].count_documents(f.view()));
        out["failedItems"]=Json::Value(Json::arrayValue);
        for(auto item:list(db["mail_outbox"],failed,"createdAt",50)){
            Json::Value row;row["id"]=item["_id"];for(const auto* field:{"kind","purpose","attempts","createdAt","expiresAt"})row[field]=item[field];out["failedItems"].append(row);
        }
        out["serverNow"]=now();return out;
    });
}
void PreferencesController::retryMail(const drogon::HttpRequestPtr& req,Callback&& cb){
    respond(std::move(cb),[&]{
        auto who=auth::require(req);ensure(who.role=="admin","Administrator access required",drogon::k403Forbidden);
        ensure(rate_limit::allow(who.id+":mail-retry",10),"Wait before retrying more messages",drogon::k429TooManyRequests);
        const auto id=text(body(req),"id",1,240);auto c=DatabaseManager::getInstance().getConnection();auto db=c->database("tranquil_talk");auto session=c->start_session();
        session.with_transaction([&](mongocxx::client_session* s){
            verified(db,who,s);ensure(find(db["users"],objectId(who.id),s)["role"]=="admin","Administrator access required",drogon::k403Forbidden);
            auto item=find(db["mail_outbox"],key(id),s);ensure(!item.isNull() && item["state"]=="failed" && item["expiresAt"].asDouble()>now(),"Only an unexpired failed message can be retried",drogon::k409Conflict);
            item["state"]="pending";item["attempts"]=0;item["nextAttempt"]=now();item.removeMember("lease");item.removeMember("leaseUntil");replace(db["mail_outbox"],key(id),item,s);
        });return message("Message queued for retry. Appointment eligibility will be checked again before delivery.");
    });
}
void PreferencesController::scheduleReminders(const drogon::HttpRequestPtr& req,Callback&& cb){
    respond(std::move(cb),[&]{
        auto who=auth::require(req);ensure(who.role=="admin","Administrator access required",drogon::k403Forbidden);
        ensure(rate_limit::allow(who.id+":reminder-backfill",10),"Wait before scheduling another batch",drogon::k429TooManyRequests);
        auto b=body(req);const auto after=b.isMember("afterId") ? text(b,"afterId",1,100) : "";
        auto c=DatabaseManager::getInstance().getConnection();auto db=c->database("tranquil_talk");auto session=c->start_session();Json::Value out;
        session.with_transaction([&](mongocxx::client_session* s){
            verified(db,who,s);ensure(find(db["users"],objectId(who.id),s)["role"]=="admin","Administrator access required",drogon::k403Forbidden);
            Json::Value q;q["status"]="accepted";q["startAt"]["$gt"]=now();if(!after.empty())q["_id"]["$gt"]=after;auto filter=bson(q);
            Json::Value sorting;sorting["_id"]=1;auto order=bson(sorting);mongocxx::options::find options;options.sort(order.view());options.limit(51);
            int processed=0;std::string last;out["nextAfterId"]=Json::nullValue;
            for(auto raw:db["appointments"].find(*s,filter.view(),options)){
                if(processed==50){out["nextAfterId"]=last;break;}
                auto a=decode(raw);appointment_mail::schedule(db,s,a,"",false);last=a["_id"].asString();++processed;
            }
            out["processed"]=processed;
        });return out;
    });
}
