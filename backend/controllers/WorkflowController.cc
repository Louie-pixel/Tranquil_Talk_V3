#include "WorkflowController.h"
#include "../utils/Workflow.h"
#include "../utils/BookingRules.h"
#include "../utils/RateLimit.h"
#include <cmath>
using namespace workflow;
namespace {
Json::Value approved(mongocxx::database db,const std::string& id,mongocxx::client_session* s=nullptr) {
    ensure(id.size()==24,"Invalid professional identifier");
    auto user=find(db["users"],objectId(id),s);
    auto p=find(db["expert_profiles"],objectId(id),s);
    ensure(!user.isNull() && user["role"].asString()=="expert" && !user["disabled"].asBool() && !user["deleted"].asBool() &&
        !p.isNull() && p["status"]=="approved" && p["approvedRevision"]==p["revision"],
        "This professional is not currently available.",drogon::k409Conflict);
    if(s) {
        user["workflowFence"]=drogon::utils::getUuid();replace(db["users"],objectId(id),user,s);
        p["workflowFence"]=drogon::utils::getUuid();replace(db["expert_profiles"],objectId(id),p,s);
    }
    return p;
}
std::string reservation(const std::string& person,double start) {return person+":"+std::to_string(static_cast<long long>(start));}
void release(mongocxx::database db,mongocxx::client_session* s,const std::string& id) {
    Json::Value q;q["appointmentId"]=id;erase(db["reservations"],q,s);
}
void reserve(mongocxx::database db,mongocxx::client_session* s,const Json::Value& a) {
    for(const auto* field:{"patientId","expertId"}) {
        Json::Value r=key(reservation(a[field].asString(),a["startAt"].asDouble()));
        r["appointmentId"]=a["_id"];r["userId"]=a[field];r["startAt"]=a["startAt"];
        insert(db["reservations"],r,s);
    }
}
Json::Value selectSlot(mongocxx::database db,mongocxx::client_session* s,const std::string& id,
                       const std::string& expert,const std::string& mode) {
    auto slot=find(db["availability"],key(id),s);
    ensure(!slot.isNull() && slot["expertId"]==expert && booking::validStart(slot["startAt"].asDouble(),now()),"Choose a future available time.",drogon::k409Conflict);
    auto p=approved(db,expert,s);bool supported=false;
    for(const auto& m:p["methods"]) if(m==mode) supported=true;
    ensure(supported && (mode=="audio" || mode=="video" || mode=="in_person"),"Choose a consultation method offered by this expert.");
    if(mode=="in_person")ensure(slot["location"].isString() && !slot["location"].asString().empty(),"This slot has no in-person location.");
    return slot;
}
Json::Value publicAppointment(mongocxx::database db,Json::Value a) {
    Json::Value result;
    for(const auto* f:{"status","mode","alias","startAt","revision","location","expertId","createdAt"})result[f]=a[f];
    result["id"]=a["_id"];result["durationMinutes"]=30;
    auto p=find(db["expert_profiles"],objectId(a["expertId"].asString()));
    result["expertName"]=p.isNull() ? "Professional unavailable" : p["name"];
    return result;
}
}
void WorkflowController::availability(const drogon::HttpRequestPtr& req,Callback&& cb,std::string id) {
    respond(std::move(cb),[&]{
        auto client=DatabaseManager::getInstance().getConnection();auto db=client->database("tranquil_talk");
        approved(db,id);
        if(req->method()==drogon::Post) {
            auto who=auth::require(req);ensure(who.id==id && who.role=="expert","Only this professional can manage their availability.",drogon::k403Forbidden);
            verified(db,who);auto b=body(req);ensure(b["startAt"].isNumeric(),"Choose a time");
            const double start=b["startAt"].asDouble();ensure(booking::validStart(start,now()),"Choose a half-hour boundary at least five minutes ahead, within 90 days.");
            Json::Value slot=key(reservation(id,start));slot["expertId"]=id;slot["startAt"]=start;
            slot["location"]=b.isMember("location") ? text(b,"location",0,240) : "";
            auto session=client->start_session();
            session.with_transaction([&](mongocxx::client_session* s){
                ensure(find(db["reservations"],key(reservation(id,start)),s).isNull(),"This time is reserved. Manage its appointment first.",drogon::k409Conflict);
                // Write the slot inside the transaction so concurrent booking/removal conflicts.
                if(b["remove"].asBool())erase(db["availability"],key(slot["_id"].asString()),s);
                else replace(db["availability"],key(slot["_id"].asString()),slot,s,true);
            });
            return message(b["remove"].asBool() ? "Availability removed." : "Thirty-minute availability added.");
        }
        Json::Value q;q["expertId"]=id;q["startAt"]["$gt"]=now()+300;
        auto slots=list(db["availability"],q,"startAt",200);Json::Value result;result["items"]=Json::Value(Json::arrayValue);
        for(auto slot:slots) {
            if(!find(db["reservations"],key(reservation(id,slot["startAt"].asDouble()))).isNull())continue;
            slot["id"]=slot["_id"];slot.removeMember("_id");slot.removeMember("touch");result["items"].append(slot);
        }
        result["durationMinutes"]=30;return result;
    });
}
void WorkflowController::appointments(const drogon::HttpRequestPtr& req,Callback&& cb) {
    respond(std::move(cb),[&]{
        auto who=auth::require(req);auto client=DatabaseManager::getInstance().getConnection();auto db=client->database("tranquil_talk");
        if(req->method()==drogon::Get) {
            Json::Value q;q["$or"][0]["patientId"]=who.id;q["$or"][1]["expertId"]=who.id;
            Json::Value out;out["items"]=Json::Value(Json::arrayValue);
            for(auto a:list(db["appointments"],q,"startAt",200))out["items"].append(publicAppointment(db,a));
            out["serverNow"]=now();return out;
        }
        ensure(who.role=="patient","Patient account required to request support.",drogon::k403Forbidden);
        ensure(rate_limit::allow(who.id+":booking",10),"Please wait before making another request.",drogon::k429TooManyRequests);
        auto b=body(req);auto expert=text(b,"expertId",24,24),slotId=text(b,"slotId",1,100),mode=text(b,"mode",5,9);
        Json::Value a=key(drogon::utils::getUuid());a["expertId"]=expert;a["patientId"]=who.id;
        a["mode"]=mode;a["alias"]=text(b,"alias",2,60);a["status"]="requested";a["revision"]=1;
        a["roomId"]=drogon::utils::getUuid();a["createdAt"]=now();
        auto session=client->start_session();
        session.with_transaction([&](mongocxx::client_session* s){
            verified(db,who,s);auto slot=selectSlot(db,s,slotId,expert,mode);
            a["startAt"]=slot["startAt"];a["slotId"]=slotId;a["location"]=mode=="in_person" ? slot["location"] : Json::Value("");
            slot["touch"]=drogon::utils::getUuid();replace(db["availability"],key(slotId),slot,s);
            reserve(db,s,a);insert(db["appointments"],a,s);
        });
        return publicAppointment(db,a);
    });
}
void WorkflowController::appointmentAction(const drogon::HttpRequestPtr& req,Callback&& cb,std::string id,std::string action) {
    respond(std::move(cb),[&]{
        auto who=auth::require(req);auto b=body(req);
        auto client=DatabaseManager::getInstance().getConnection();auto db=client->database("tranquil_talk");
        Json::Value result;auto session=client->start_session();
        session.with_transaction([&](mongocxx::client_session* s){
            auto a=find(db["appointments"],key(id),s);
            ensure(!a.isNull() && (a["patientId"]==who.id || a["expertId"]==who.id),"Appointment unavailable.",drogon::k404NotFound);
            const bool expert=a["expertId"]==who.id;
            if(action=="join") {
                verified(db,who,s);approved(db,a["expertId"].asString(),s);
                ensure(booking::canJoin(a["status"].asString(),a["mode"].asString(),a["startAt"].asDouble(),now()),
                    "Your waiting room opens ten minutes before an accepted online appointment and closes at its end.",drogon::k403Forbidden);
                const auto expiry=std::chrono::system_clock::from_time_t(static_cast<time_t>(a["startAt"].asDouble()+booking::duration));
                auto u=find(db["users"],objectId(who.id),s);
                result["ticket"]=jwt::create().set_issuer("tranquil_talk").set_type("JWT").set_subject(a["roomId"].asString())
                    .set_audience("tranquil-appointment").set_issued_at(std::chrono::system_clock::now()).set_expires_at(expiry)
                    .set_payload_claim("role",jwt::claim("participant"))
                    .set_payload_claim("userId",jwt::claim(who.id)).set_payload_claim("appointmentId",jwt::claim(id))
                    .set_payload_claim("version",jwt::claim(std::to_string(u.get("sessionVersion",0).asInt())))
                    .sign(jwt::algorithm::hs256{auth::secret()});
                result["mode"]=a["mode"];result["alias"]=expert ? Json::Value("Professional") : a["alias"];
                result["startAt"]=a["startAt"];return;
            }
            ensure(b["revision"].isInt() && b["revision"]==a["revision"],"Appointment changed. Refresh before deciding.",drogon::k409Conflict);
            ensure(a["startAt"].asDouble()>now(),"This appointment has already started.",drogon::k409Conflict);
            ensure(booking::canDecide(a["status"].asString(),expert,action),"This action is not available for your role or the current appointment.",drogon::k409Conflict);
            auto expected=key(id);expected["revision"]=a["revision"];
            if(action=="accept") {verified(db,who,s);approved(db,a["expertId"].asString(),s);a["status"]="accepted";}
            else if(action=="propose") {
                verified(db,who,s);const auto slotId=text(b,"slotId",1,100);
                auto slot=selectSlot(db,s,slotId,a["expertId"].asString(),a["mode"].asString());
                release(db,s,id);a["startAt"]=slot["startAt"];a["slotId"]=slotId;
                a["location"]=a["mode"]=="in_person" ? slot["location"] : Json::Value("");
                a["status"]="proposed";slot["touch"]=drogon::utils::getUuid();replace(db["availability"],key(slotId),slot,s);reserve(db,s,a);
            } else {a["status"]=action=="decline" ? "declined" : "cancelled";release(db,s,id);}
            a["revision"]=a["revision"].asInt()+1;a["updatedAt"]=now();replace(db["appointments"],expected,a,s);
            result=a;
        });
        return action=="join" ? result : publicAppointment(db,result);
    });
}
void WorkflowController::rtcConfig(const drogon::HttpRequestPtr& req,Callback&& cb) {
    respond(std::move(cb),[&]{
        auth::require(req);Json::Value result;result["iceServers"]=Json::Value(Json::arrayValue);
        const auto host=env("TURN_URL"),secret=env("TURN_SECRET");
        result["relayAvailable"]=!host.empty() && !secret.empty();
        if(result["relayAvailable"].asBool()) {
            const std::string username=std::to_string(static_cast<long long>(now()+3600))+":"+drogon::utils::getUuid();
            unsigned char digest[EVP_MAX_MD_SIZE];unsigned int length=0;
            HMAC(EVP_sha1(),secret.data(),static_cast<int>(secret.size()),reinterpret_cast<const unsigned char*>(username.data()),username.size(),digest,&length);
            const auto encodedLength=4*((length+2)/3);
            std::string credential(encodedLength+1,'\0');EVP_EncodeBlock(reinterpret_cast<unsigned char*>(&credential[0]),digest,static_cast<int>(length));credential.resize(encodedLength);
            Json::Value turn;turn["urls"]=host;turn["username"]=username;turn["credential"]=credential;result["iceServers"].append(turn);
            result["iceTransportPolicy"]="relay";
        } else {Json::Value stun;stun["urls"]="stun:stun.l.google.com:19302";result["iceServers"].append(stun);result["iceTransportPolicy"]="all";}
        return result;
    });
}
