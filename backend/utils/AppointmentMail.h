#pragma once
#include "Timezones.h"
#include <algorithm>
namespace appointment_mail {
// Inserted in the booking transaction. Deterministic keys survive transaction retries.
inline void schedule(mongocxx::database db,mongocxx::client_session* session,const Json::Value& a,const std::string& onlyUser="",bool includeUpdate=true){
    const auto id=a["_id"].asString();
    Json::Value old;old["appointmentId"]=id;old["state"]="pending";
    if(!onlyUser.empty())old["userId"]=onlyUser;
    if(!includeUpdate)old["purpose"]["$ne"]="update";
    workflow::erase(db["mail_outbox"],old,session);
    for(const auto* field:{"patientId","expertId"}){
        const auto userId=a[field].asString();if(!onlyUser.empty() && onlyUser!=userId)continue;auto u=workflow::find(db["users"],workflow::objectId(userId),session);
        if(u.isNull() || !u.get("emailVerified",false).asBool() || !u.get("appointmentEmails",true).asBool())continue;
        auto add=[&](const std::string& type,double due,double expires){
            auto item=workflow::key("appointment:"+id+":"+std::to_string(a["revision"].asInt())+":"+userId+":"+type);
            item["kind"]="appointment";item["appointmentId"]=id;item["userId"]=userId;item["appointmentRevision"]=a["revision"];
            item["purpose"]=type;item["state"]="pending";item["createdAt"]=workflow::now();item["nextAttempt"]=due;item["expiresAt"]=expires;
            workflow::replace(db["mail_outbox"],workflow::key(item["_id"].asString()),item,session,true);
        };
        const bool active=a["status"]=="requested" || a["status"]=="proposed" || a["status"]=="accepted";
        if(includeUpdate)add("update",workflow::now(),active ? std::min(workflow::now()+86400,a["startAt"].asDouble()) : workflow::now()+86400);
        if(a["status"]=="accepted" && u.get("appointmentReminders",true).asBool()){
            for(const int lead:{86400,3600}){
                const auto due=a["startAt"].asDouble()-lead;
                if(due>workflow::now())add("reminder-"+std::to_string(lead),due,a["startAt"].asDouble());
            }
        }
    }
}
inline bool resolve(mongocxx::database db,Json::Value& item){
    auto a=workflow::find(db["appointments"],workflow::key(item["appointmentId"].asString()));
    if(a.isNull() || a["revision"]!=item["appointmentRevision"])return false;
    const auto userId=item["userId"].asString();
    if(a["patientId"]!=userId && a["expertId"]!=userId)return false;
    auto u=workflow::find(db["users"],workflow::objectId(userId));
    const bool reminder=item["purpose"]!="update";
    if(reminder){
        auto expert=workflow::find(db["users"],workflow::objectId(a["expertId"].asString()));
        auto profile=workflow::find(db["expert_profiles"],workflow::objectId(a["expertId"].asString()));
        if(expert.isNull() || expert.get("disabled",false).asBool() || expert.get("deleted",false).asBool() || profile.isNull() || profile["status"]!="approved" || profile["revision"]!=profile["approvedRevision"])return false;
    }
    if(u.isNull() || !u.get("emailVerified",false).asBool() || u.get("deleted",false).asBool() || u.get("disabled",false).asBool() ||
       !u.get("appointmentEmails",true).asBool() || (reminder && (!u.get("appointmentReminders",true).asBool() || a["status"]!="accepted" || a["startAt"].asDouble()<=workflow::now())))return false;
    const auto when=timezones::describe(a["startAt"].asDouble(),timezones::forUser(u));
    item["to"]=u["email"];item["subject"]=reminder ? "Tranquil Talk appointment reminder" : "Tranquil Talk appointment update";
    // Never include patient name, email, alias, clinical details or consultation credentials.
    item["text"]="Appointment status: "+a["status"].asString()+".\nScheduled time: "+when["localStart"].asString()+" ("+when["timeZone"].asString()+").\nDuration: 30 minutes.\nSign in to review details and available actions.\nManage email preferences in your account.";
    return true;
}
}
