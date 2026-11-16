#include "ManagementController.h"
#include "../utils/Workflow.h"
#include "../utils/Validation.h"
#include "../utils/RateLimit.h"
#include <ctime>
#include <cmath>
using namespace workflow;
namespace {
void access(mongocxx::database db,const auth::Identity& who,const std::string& kind,mongocxx::client_session* s=nullptr){
    ensure(kind=="clinics" || kind=="events","Management resource unavailable.",drogon::k404NotFound);
    ensure(who.role=="admin" || (kind=="clinics" && who.role=="expert"),"This workspace is restricted to authorised professionals or administrators.",drogon::k403Forbidden);
    verified(db,who,s);
    auto u=find(db["users"],objectId(who.id),s);
    ensure(u["role"]==who.role,"Account permissions changed. Sign in again.",drogon::k403Forbidden);
    if(who.role=="expert"){
        auto p=find(db["expert_profiles"],objectId(who.id),s);
        ensure(!p.isNull() && p["status"]=="approved" && p["revision"]==p["approvedRevision"],"Professional approval required.",drogon::k403Forbidden);
        if(s){p["workflowFence"]=drogon::utils::getUuid();replace(db["expert_profiles"],objectId(who.id),p,s);}
    }
}
Json::Value output(Json::Value record){
    record["id"]=record["_id"]["$oid"];record.removeMember("_id");record.removeMember("ownerId");
    record["revision"]=record.get("revision",0);record["archived"]=record.get("archived",false);return record;
}
Json::Value fields(const Json::Value& b,const std::string& kind){
    Json::Value d;
    if(kind=="clinics"){
        d["name"]=text(b,"name",2,200);
        ensure(b["lat"].isNumeric() && b["lng"].isNumeric(),"Choose the clinic's actual coordinates.");
        const auto lat=b["lat"].asDouble(),lng=b["lng"].asDouble();
        ensure(std::isfinite(lat) && std::abs(lat)<=90 && std::isfinite(lng) && std::abs(lng)<=180,"Invalid clinic coordinates.");
        d["location"]["type"]="Point";d["location"]["coordinates"][0]=lng;d["location"]["coordinates"][1]=lat;
        for(const auto* f:{"address","suburb","city","country","phone","website"})d[f]=b.isMember(f) ? text(b,f,0,std::string(f)=="website" ? 512 : 240) : "";
        ensure(!d["city"].asString().empty() && !d["address"].asString().empty(),"An accurate clinic address and city are required.");
        ensure(d["website"]=="" || experts::httpsUrl(d["website"].asString()),"Clinic websites must use HTTPS.");
    }else{
        d["title"]=text(b,"title",3,200);d["description"]=text(b,"description",20,4000);d["location"]=text(b,"location",3,240);
        ensure(b["startAt"].isNumeric(),"Choose an event date and time.");const auto start=b["startAt"].asDouble();
        ensure(std::isfinite(start) && start>now() && start<now()+366*86400,"Choose a future event within the next year.");
        std::time_t stamp=static_cast<time_t>(start);std::tm utc{};
#ifdef _WIN32
        gmtime_s(&utc,&stamp);
#else
        gmtime_r(&stamp,&utc);
#endif
        char date[32];std::strftime(date,sizeof(date),"%Y-%m-%dT%H:%M:%SZ",&utc);d["startsAt"]=date;
    }
    ensure(!b.isMember("archived") || b["archived"].isBool(),"Archived must be a boolean.");
    d["archived"]=b.get("archived",false);return d;
}
}
void ManagementController::collection(const drogon::HttpRequestPtr& req,Callback&& cb,std::string kind){
    respond(std::move(cb),[&]{
        auto who=auth::require(req);auto c=DatabaseManager::getInstance().getConnection();auto db=c->database("tranquil_talk");access(db,who,kind);
        if(req->method()==drogon::Get){
            int offset=0;try{if(!req->getParameter("offset").empty()){const auto n=validation::number(req->getParameter("offset"),0,10000);ensure(n==std::floor(n),"Invalid page offset.");offset=static_cast<int>(n);}}catch(const std::invalid_argument&){throw Error(drogon::k400BadRequest,"Invalid page offset.");}
            Json::Value q(Json::objectValue);if(who.role!="admin")q["ownerId"]=who.id;auto filter=bson(q);
            mongocxx::options::find options;
            Json::Value sorting;sorting["updatedAt"]=-1;sorting["_id"]=1;auto order=bson(sorting);options.sort(order.view());options.skip(offset);options.limit(51);
            Json::Value result;result["items"]=Json::Value(Json::arrayValue);for(auto row:db[kind].find(filter.view(),options))result["items"].append(output(decode(row)));
            if(result["items"].size()>50){result["items"].resize(50);result["nextOffset"]=offset+50;}else result["nextOffset"]=Json::nullValue;return result;
        }
        ensure(rate_limit::allow(who.id+":manage",30),"Please wait before submitting more changes.",drogon::k429TooManyRequests);
        auto d=fields(body(req),kind);const auto id=bsoncxx::oid{}.to_string();d["_id"]=objectId(id)["_id"];d["ownerId"]=who.id;d["revision"]=1;d["createdAt"]=now();d["updatedAt"]=now();
        auto session=c->start_session();session.with_transaction([&](mongocxx::client_session* s){access(db,who,kind,s);insert(db[kind],d,s);});
        return output(d);
    });
}
void ManagementController::item(const drogon::HttpRequestPtr& req,Callback&& cb,std::string kind,std::string id){
    respond(std::move(cb),[&]{
        auto who=auth::require(req);ensure(id.size()==24 && id.find_first_not_of("0123456789abcdefABCDEF")==std::string::npos,"Invalid record identifier.");
        auto b=body(req);ensure(b["revision"].isInt(),"Send the version of the record you opened.");
        auto c=DatabaseManager::getInstance().getConnection();auto db=c->database("tranquil_talk");Json::Value result;
        auto session=c->start_session();session.with_transaction([&](mongocxx::client_session* s){
            access(db,who,kind,s);auto current=find(db[kind],objectId(id),s);
            ensure(!current.isNull() && (who.role=="admin" || current.get("ownerId","")==who.id),"This record is unavailable.",drogon::k404NotFound);
            ensure(current.get("revision",0)==b["revision"],"This record changed. Refresh before saving.",drogon::k409Conflict);
            if(req->method()==drogon::Delete){current["archived"]=true;result=current;}
            else{result=fields(b,kind);result["_id"]=current["_id"];result["ownerId"]=current.get("ownerId",who.id);result["createdAt"]=current.get("createdAt",now());}
            result["revision"]=b["revision"].asInt()+1;result["updatedAt"]=now();replace(db[kind],objectId(id),result,s);
        });return output(result);
    });
}
