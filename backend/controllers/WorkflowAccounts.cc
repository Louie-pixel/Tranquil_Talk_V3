#include "WorkflowController.h"
#include "../utils/Workflow.h"
#include "../utils/Mail.h"
#include "../utils/RateLimit.h"
#include "../utils/Validation.h"
#include <bcrypt/BCrypt.hpp>
using namespace workflow;
void WorkflowController::accountAction(const drogon::HttpRequestPtr& req,Callback&& cb,std::string action) {
    respond(std::move(cb),[&]{
        auto b=body(req);auto client=DatabaseManager::getInstance().getConnection();auto db=client->database("tranquil_talk");
        ensure(rate_limit::allow(req->peerAddr().toIp()+":account-action",10),"Please wait before trying again.",drogon::k429TooManyRequests);
        if(action=="request-verification" || action=="request-reset") {
            ensure(mail::ready(),"Email delivery is not configured. Contact the site operator.",drogon::k503ServiceUnavailable);
            const auto base=mail::baseUrl();Json::Value u;
            if(action=="request-verification") {auto who=auth::require(req);u=find(db["users"],objectId(who.id));}
            else {auto email=validation::email(text(b,"email",3,254));ensure(validation::validEmail(email),"Enter a valid email.");Json::Value q;q["email"]=email;u=find(db["users"],q);}
            const std::string purpose=action=="request-reset" ? "reset" : "verify";
            if(!u.isNull() && !u.get("deleted",false).asBool() && !u.get("disabled",false).asBool() && !(purpose=="verify" && u["emailVerified"].asBool())) {
                const auto id=u["_id"]["$oid"].asString();
                // Per-account throttling prevents inbox flooding, including from a signed-in client.
                if(rate_limit::allow(id+":mail:"+purpose,1)) {
                    auto token=drogon::utils::getUuid()+drogon::utils::getUuid();
                    Json::Value record=key(id+":"+purpose);record["userId"]=id;record["purpose"]=purpose;
                    record["hash"]=hash(token);record["expiresAt"]=now()+1800;record["version"]=u.get("sessionVersion",0);
                    Json::Value out=key(drogon::utils::getUuid());out["userId"]=id;out["to"]=u["email"];out["purpose"]=purpose;
                    out["url"]=base+"/#account/"+purpose+"/"+token;out["createdAt"]=now();out["expiresAt"]=now()+1800;out["nextAttempt"]=now();out["state"]="pending";
                    auto session=client->start_session();session.with_transaction([&](mongocxx::client_session* s){
                        replace(db["account_actions"],key(id+":"+purpose),record,s,true);
                        Json::Value q;q["userId"]=id;q["purpose"]=purpose;erase(db["mail_outbox"],q,s);insert(db["mail_outbox"],out,s);
                    });
                }
            }
            return message("If the account is eligible, an email will arrive shortly. Check your inbox and spam folder.");
        }
        if(action=="verify" || action=="reset") {
            const auto token=text(b,"token",64,100);Json::Value q;q["hash"]=hash(token);q["purpose"]=action;
            std::string newHash;
            if(action=="reset") {ensure(b["password"].isString(),"Enter a new password.");auto password=b["password"].asString();ensure(validation::password(password),"Use a password of 12-72 bytes.");newHash=BCrypt::generateHash(password,12);}
            auto session=client->start_session();session.with_transaction([&](mongocxx::client_session* s){
                auto t=find(db["account_actions"],q,s);
                ensure(!t.isNull() && t["expiresAt"].asDouble()>now(),"This link is invalid, used or expired. Request another.");
                auto u=find(db["users"],objectId(t["userId"].asString()),s);
                ensure(!u.isNull() && !u.get("deleted",false).asBool() && !u.get("disabled",false).asBool() && u.get("sessionVersion",0)==t["version"],"This link is no longer valid.");
                if(action=="verify")u["emailVerified"]=true;
                else {u["password"]=newHash;u["sessionVersion"]=u.get("sessionVersion",0).asInt()+1;}
                replace(db["users"],objectId(t["userId"].asString()),u,s);erase(db["account_actions"],key(t["_id"].asString()),s);
                Json::Value outq;outq["userId"]=t["userId"];outq["purpose"]=action;erase(db["mail_outbox"],outq,s);
            });
            return message(action=="verify" ? "Email verified. You can now request and manage appointments." : "Password reset. Sign in with your new password. Previous sessions have ended.");
        }
        if(action=="delete") {
            auto who=auth::require(req);ensure(b["confirmation"]=="DELETE","Type DELETE to confirm account deletion.");
            ensure(b["password"].isString() && !b["password"].asString().empty() && b["password"].asString().size()<=72,"Enter your current password.");
            auto password=b["password"].asString();auto u=find(db["users"],objectId(who.id));
            ensure(!u.isNull() && BCrypt::validatePassword(password,u["password"].asString()),"Password is incorrect.",drogon::k403Forbidden);
            auto session=client->start_session();session.with_transaction([&](mongocxx::client_session* s){
                auto current=find(db["users"],objectId(who.id),s);
                ensure(!current.isNull() && current["password"]==u["password"],"Account changed. Sign in again.",drogon::k409Conflict);
                Json::Value member;member["$or"][0]["patientId"]=who.id;member["$or"][1]["expertId"]=who.id;
                auto f=bson(member);for(auto raw:db["appointments"].find(*s,f.view())) {
                    auto a=decode(raw);Json::Value r;r["appointmentId"]=a["_id"];erase(db["reservations"],r,s);
                }
                erase(db["appointments"],member,s);erase(db["expert_profiles"],objectId(who.id),s);
                Json::Value q;q["expertId"]=who.id;erase(db["availability"],q,s);
                q=Json::Value();q["userId"]=who.id;for(const auto* collection:{"account_actions","mail_outbox","reservations"})erase(db[collection],q,s);
                q=Json::Value();q["authorId"]=who.id;erase(db["blogs"],q,s);
                q=Json::Value();q["ownerId"]=who.id;erase(db["clinics"],q,s);
                q=Json::Value();q["reporterId"]=who.id;erase(db["reports"],q,s);
                erase(db["users"],objectId(who.id),s);
            });
            return message("Account deleted. Your future appointments and private profile data have been removed.");
        }
        throw Error(drogon::k404NotFound,"Account action unavailable.");
    });
}
void WorkflowController::reports(const drogon::HttpRequestPtr& req,Callback&& cb) {
    respond(std::move(cb),[&]{
        auto who=auth::require(req);auto client=DatabaseManager::getInstance().getConnection();auto db=client->database("tranquil_talk");
        if(req->method()==drogon::Get) {
            ensure(who.role=="admin","Administrator access required.",drogon::k403Forbidden);
            Json::Value q;q["status"]="open";Json::Value result;result["items"]=list(db["reports"],q,"createdAt",100);
            for(auto& r:result["items"]) {r["id"]=r["_id"];r.removeMember("_id");}return result;
        }
        verified(db,who);ensure(rate_limit::allow(who.id+":reports",5),"Please wait before sending another report.",drogon::k429TooManyRequests);
        auto b=body(req);Json::Value report=key(drogon::utils::getUuid());
        auto type=text(b,"targetType",4,16),id=text(b,"targetId",1,100);
        ensure(type=="expert" || type=="appointment" || type=="article","Choose a supported report type.");
        if(type=="appointment") {auto a=find(db["appointments"],key(id));ensure(!a.isNull() && (a["patientId"]==who.id || a["expertId"]==who.id),"Appointment unavailable.",drogon::k404NotFound);}
        else {auto r=find(db[type=="expert" ? "expert_profiles" : "blogs"],objectId(id));ensure(!r.isNull(),"The reported item is unavailable.",drogon::k404NotFound);}
        report["targetType"]=type;report["targetId"]=id;report["reporterId"]=who.id;report["reason"]=text(b,"reason",10,2000);
        report["status"]="open";report["revision"]=1;report["createdAt"]=now();insert(db["reports"],report);
        return message("Report received. An administrator will review it. This is not an emergency response channel.");
    });
}
void WorkflowController::reviewReport(const drogon::HttpRequestPtr& req,Callback&& cb,std::string id) {
    respond(std::move(cb),[&]{
        auto who=auth::require(req);ensure(who.role=="admin","Administrator access required.",drogon::k403Forbidden);
        auto b=body(req);auto action=text(b,"action",4,16),note=text(b,"note",10,1000);
        ensure(action=="dismiss" || action=="remove" || action=="restrict","Choose dismiss, remove or restrict.");
        auto client=DatabaseManager::getInstance().getConnection();auto db=client->database("tranquil_talk");auto session=client->start_session();
        session.with_transaction([&](mongocxx::client_session* s){
            auto r=find(db["reports"],key(id),s);ensure(!r.isNull() && r["status"]=="open","This report is no longer open.",drogon::k409Conflict);
            const auto target=r["targetId"].asString(),type=r["targetType"].asString();
            if(action=="remove") {ensure(type=="article","Remove applies to articles. Use the verification workflow to suspend an expert.");erase(db["blogs"],objectId(target),s);}
            if(action=="restrict") {
                ensure(type=="expert","Account restrictions apply to reported expert accounts.");ensure(target!=who.id,"You cannot restrict your own account.");
                auto u=find(db["users"],objectId(target),s);ensure(!u.isNull() && u["role"]!="admin","Account cannot be restricted here.");
                u["disabled"]=true;u["sessionVersion"]=u.get("sessionVersion",0).asInt()+1;replace(db["users"],objectId(target),u,s);
                auto p=find(db["expert_profiles"],objectId(target),s);if(!p.isNull()) {p["status"]="suspended";p["revision"]=p["revision"].asInt()+1;replace(db["expert_profiles"],objectId(target),p,s);}
            }
            r["status"]="resolved";r["decision"]=action;r["reviewNote"]=note;r["reviewerId"]=who.id;r["resolvedAt"]=now();r["revision"]=r["revision"].asInt()+1;
            auto q=key(id);q["status"]="open";replace(db["reports"],q,r,s);
        });
        return message("Moderation decision recorded.");
    });
}

