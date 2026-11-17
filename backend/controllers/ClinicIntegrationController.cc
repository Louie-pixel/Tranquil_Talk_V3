#include "ClinicIntegrationController.h"
#include "../utils/Workflow.h"
#include "../utils/RateLimit.h"
#include <cmath>
#include <set>
#include <regex>
using namespace workflow;
namespace {
void administrator(mongocxx::database db,const auth::Identity& who,mongocxx::client_session* s=nullptr){
    ensure(who.role=="admin","Administrator access required",drogon::k403Forbidden);verified(db,who,s);
    ensure(find(db["users"],objectId(who.id),s)["role"]=="admin","Administrator access required",drogon::k403Forbidden);
}
Json::Value clinic(const Json::Value& b){
    Json::Value d;d["externalId"]=text(b,"externalId",1,100);d["name"]=text(b,"name",2,200);
    ensure(std::regex_match(d["externalId"].asString(),std::regex("^[A-Za-z0-9_:/.-]+$")),"Invalid external clinic identifier");
    ensure(b["lat"].isNumeric() && b["lng"].isNumeric(),"Clinic coordinates are required");
    const auto lat=b["lat"].asDouble(),lng=b["lng"].asDouble();
    ensure(std::isfinite(lat) && std::isfinite(lng) && std::abs(lat)<=90 && std::abs(lng)<=180,"Invalid clinic coordinates");
    d["location"]["type"]="Point";d["location"]["coordinates"][0]=lng;d["location"]["coordinates"][1]=lat;
    for(const auto* f:{"address","suburb","city","country","phone","website"})d[f]=b.isMember(f) ? text(b,f,0,std::string(f)=="website" ? 512 : 240) : "";
    ensure(!d["address"].asString().empty() && !d["city"].asString().empty() && !d["country"].asString().empty(),"Review and complete the address, city and country before import");
    ensure(d["website"]=="" || experts::httpsUrl(d["website"].asString()),"Clinic website must use HTTPS");
    const auto category=b.get("category","general_clinic").asString();
    ensure(category=="mental_health" || category=="general_clinic" || category=="hospital","Invalid clinic category");d["category"]=category;return d;
}
std::string tag(const Json::Value& tags,const char* name,size_t length=240){
    if(!tags[name].isString())return "";auto value=experts::trim(tags[name].asString());return experts::clean(value,length) ? value : "";
}
}
void ClinicIntegrationController::preview(const drogon::HttpRequestPtr& req,Callback&& cb){
    respond(std::move(cb),[&]{
        auto who=auth::require(req);auto c=DatabaseManager::getInstance().getConnection();auto db=c->database("tranquil_talk");administrator(db,who);
        ensure(env("CLINIC_OSM_ENABLED")=="true","OpenStreetMap integration is not enabled by the operator",drogon::k503ServiceUnavailable);
        ensure(rate_limit::allow("osm-preview",1),"Wait one minute before another directory request",drogon::k429TooManyRequests);
        auto b=body(req);ensure(b["lat"].isNumeric() && b["lng"].isNumeric() && b["radius"].isNumeric(),"Provide an area centre and radius in metres");
        const auto lat=b["lat"].asDouble(),lng=b["lng"].asDouble(),radius=b["radius"].asDouble();
        ensure(std::isfinite(lat) && std::isfinite(lng) && std::abs(lat)<=90 && std::abs(lng)<=180 && std::isfinite(radius) && radius>=100 && radius<=10000,"Choose an area radius between 100 and 10000 metres");
        // Fixed upstream and generated numeric parameters prevent arbitrary URL/query injection.
        const auto area="(around:"+std::to_string(static_cast<int>(radius))+","+std::to_string(lat)+","+std::to_string(lng)+")";
        const auto query="[out:json][timeout:20][maxsize:2097152];(nwr[\"healthcare\"~\"^(psychotherapist|psychologist|psychiatrist)$\"]"+area+";nwr[\"amenity\"~\"^(clinic|hospital)$\"]"+area+";);out center 51;";
        auto request=drogon::HttpRequest::newHttpRequest();request->setMethod(drogon::Post);request->setPath("/api/interpreter");request->setContentTypeCode(drogon::CT_TEXT_PLAIN);request->setBody(query);request->addHeader("User-Agent","TranquilTalk-ClinicDirectory/1.0");
        auto upstream=drogon::HttpClient::newHttpClient("https://overpass-api.de")->sendRequest(request,25);
        ensure(upstream.first==drogon::ReqResult::Ok && upstream.second && upstream.second->statusCode()==200,"Clinic source unavailable or rate limited. Retry later.",drogon::k503ServiceUnavailable);
        ensure(upstream.second->body().size()<=2097152,"Clinic source response too large",drogon::k503ServiceUnavailable);
        auto json=upstream.second->getJsonObject();ensure(json && (*json)["elements"].isArray() && !json->isMember("remark"),"The clinic source returned an incomplete result",drogon::k503ServiceUnavailable);
        Json::Value out;out["sourceId"]="openstreetmap";out["sourceName"]="OpenStreetMap contributors";out["sourceUrl"]="https://www.openstreetmap.org/copyright";
        out["attribution"]="� OpenStreetMap contributors, ODbL";out["items"]=Json::Value(Json::arrayValue);out["truncated"]=(*json)["elements"].size()>50;
        for(const auto& node:(*json)["elements"]){
            if(out["items"].size()>=50)break;
            const auto& tags=node["tags"];const auto& point=node.isMember("center") ? node["center"] : node;
            if(tag(tags,"name",200).size()<2 || !point["lat"].isNumeric() || !point["lon"].isNumeric())continue;
            const auto type=node.get("type","").asString();if(type!="node" && type!="way" && type!="relation")continue;
            Json::Value item;item["externalId"]=type+"/"+node["id"].asString();item["name"]=tag(tags,"name",200);item["lat"]=point["lat"];item["lng"]=point["lon"];
            auto address=tag(tags,"addr:full");if(address.empty()){address=tag(tags,"addr:housenumber");const auto street=tag(tags,"addr:street");if(!street.empty())address+=(address.empty() ? "" : " ")+street;}
            item["address"]=address;item["city"]=tag(tags,"addr:city");item["suburb"]=tag(tags,"addr:suburb");item["country"]=tag(tags,"addr:country");
            item["phone"]=tag(tags,"contact:phone");if(item["phone"]=="")item["phone"]=tag(tags,"phone");
            auto website=tag(tags,"contact:website",512);if(website.empty())website=tag(tags,"website",512);item["website"]=experts::httpsUrl(website) ? website : "";
            const auto healthcare=tag(tags,"healthcare");item["category"]=(healthcare=="psychotherapist" || healthcare=="psychologist" || healthcare=="psychiatrist") ? "mental_health" : tag(tags,"amenity")=="hospital" ? "hospital" : "general_clinic";
            item["sourceRecordUrl"]="https://www.openstreetmap.org/"+item["externalId"].asString();out["items"].append(item);
        }
        out["message"]="Preview only. Check every address, contact and service before importing. Map data does not establish professional approval, opening hours or clinical suitability.";return out;
    });
}
void ClinicIntegrationController::importClinics(const drogon::HttpRequestPtr& req,Callback&& cb){
    respond(std::move(cb),[&]{
        auto who=auth::require(req);auto c=DatabaseManager::getInstance().getConnection();auto db=c->database("tranquil_talk");administrator(db,who);
        ensure(rate_limit::allow(who.id+":clinic-import",5),"Wait before importing another batch",drogon::k429TooManyRequests);
        auto b=body(req);ensure(b["reviewed"].isBool() && b["reviewed"].asBool(),"Confirm that these directory details have been reviewed");
        auto source=text(b,"sourceId",2,60),sourceName=text(b,"sourceName",2,200),sourceUrl=text(b,"sourceUrl",8,512);
        ensure(std::regex_match(source,std::regex("^[a-z0-9_-]+$")) && experts::httpsUrl(sourceUrl),"Use a source identifier and HTTPS attribution URL");
        ensure(!b.isMember("overwriteReviewed") || b["overwriteReviewed"].isBool(),"overwriteReviewed must be a boolean");
        ensure(b["items"].isArray() && !b["items"].empty() && b["items"].size()<=50,"Import between 1 and 50 clinics per batch");
        Json::Value items(Json::arrayValue);std::set<std::string> ids;
        for(const auto& value:b["items"]){auto d=clinic(value);ensure(ids.insert(d["externalId"].asString()).second,"Duplicate external identifier in this batch");items.append(d);}
        Json::Value result;auto session=c->start_session();session.with_transaction([&](mongocxx::client_session* s){
            administrator(db,who,s);int created=0,updated=0,skipped=0;
            for(auto d:items){
                const auto id=hash(source+":"+d["externalId"].asString()).substr(0,24);auto current=find(db["clinics"],objectId(id),s);
                ensure(current.isNull() || (current["sourceId"]==source && current["externalId"]==d["externalId"]),"Source identifier conflicts with an existing listing",drogon::k409Conflict);
                if(!current.isNull() && current.get("sourceLocked",false).asBool() && !b.get("overwriteReviewed",false).asBool()){++skipped;continue;}
                d["_id"]=objectId(id)["_id"];d["ownerId"]=current.isNull() ? Json::Value(who.id) : current["ownerId"];
                d["sourceId"]=source;d["sourceName"]=sourceName;d["sourceUrl"]=sourceUrl;d["sourceUpdatedAt"]=now();d["sourceLocked"]=false;
                d["archived"]=current.get("archived",false);d["revision"]=current.get("revision",0).asInt()+1;d["createdAt"]=current.get("createdAt",now());d["updatedAt"]=now();
                replace(db["clinics"],objectId(id),d,s,true);if(current.isNull())++created;else ++updated;
            }
            auto audit=key(drogon::utils::getUuid());audit["operatorId"]=who.id;audit["sourceId"]=source;audit["createdAt"]=now();audit["created"]=created;audit["updated"]=updated;audit["skipped"]=skipped;insert(db["clinic_imports"],audit,s);
            result["created"]=created;result["updated"]=updated;result["skippedReviewed"]=skipped;
        });return result;
    });
}
