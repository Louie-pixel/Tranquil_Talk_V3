#pragma once
#include "Auth.h"
#include "Http.h"
#include <bsoncxx/json.hpp>
#include <mongocxx/client_session.hpp>
#include <mongocxx/options/find.hpp>
#include <mongocxx/options/replace.hpp>
#include <mongocxx/exception/operation_exception.hpp>
#include <openssl/sha.h>
#include <openssl/hmac.h>
#include <openssl/evp.h>
#include <iomanip>
#include <sstream>
#include <typeinfo>

namespace workflow {
using Callback = std::function<void(const drogon::HttpResponsePtr&)>;
struct Error : std::runtime_error {
    drogon::HttpStatusCode code;
    Error(drogon::HttpStatusCode c, const std::string& m) : std::runtime_error(m), code(c) {}
};
inline void ensure(bool condition, const std::string& message,
                   drogon::HttpStatusCode code = drogon::k400BadRequest) {
    if (!condition) throw Error(code, message);
}
inline double now() { return static_cast<double>(std::time(nullptr)); }
inline std::string env(const char* name) { auto p=std::getenv(name); return p ? p : ""; }
inline std::string encode(const Json::Value& value) {
    Json::StreamWriterBuilder b; b["indentation"]=""; return Json::writeString(b,value);
}
inline Json::Value decode(bsoncxx::document::view value) {
    Json::Value result; std::string error; Json::CharReaderBuilder b;
    std::istringstream input(bsoncxx::to_json(value, bsoncxx::ExtendedJsonMode::k_relaxed));
    if (!Json::parseFromStream(b,input,&result,&error)) throw std::runtime_error("Invalid database record");
    return result;
}
inline bsoncxx::document::value bson(const Json::Value& value) { return bsoncxx::from_json(encode(value)); }
inline Json::Value key(const std::string& id) { Json::Value q; q["_id"]=id; return q; }
inline Json::Value objectId(const std::string& id) { Json::Value q; q["_id"]["$oid"]=id; return q; }
inline Json::Value find(mongocxx::collection c, const Json::Value& q, mongocxx::client_session* s=nullptr) {
    auto f=bson(q); auto record=s ? c.find_one(*s,f.view()) : c.find_one(f.view());
    return record ? decode(record->view()) : Json::Value();
}
inline void insert(mongocxx::collection c, const Json::Value& d, mongocxx::client_session* s=nullptr) {
    auto doc=bson(d); if(s)c.insert_one(*s,doc.view());else c.insert_one(doc.view());
}
inline void replace(mongocxx::collection c, const Json::Value& q, const Json::Value& d,
                    mongocxx::client_session* s=nullptr, bool upsert=false) {
    auto f=bson(q),doc=bson(d); mongocxx::options::replace options; options.upsert(upsert);
    auto r=s ? c.replace_one(*s,f.view(),doc.view(),options) : c.replace_one(f.view(),doc.view(),options);
    ensure(upsert || (r && r->matched_count()==1),"This record changed. Refresh and try again.",drogon::k409Conflict);
}
inline void erase(mongocxx::collection c,const Json::Value& q,mongocxx::client_session* s=nullptr) {
    auto f=bson(q); if(s)c.delete_many(*s,f.view());else c.delete_many(f.view());
}
inline Json::Value list(mongocxx::collection c,const Json::Value& q, const std::string& sort="createdAt",int limit=100) {
    auto f=bson(q); Json::Value order; order[sort]=1;
    auto sortDoc=bson(order);mongocxx::options::find options;options.sort(sortDoc.view());options.limit(limit);
    Json::Value result(Json::arrayValue);for(auto d:c.find(f.view(),options)) result.append(decode(d));return result;
}
inline Json::Value body(const drogon::HttpRequestPtr& req) {
    auto p=req->getJsonObject();ensure(p && p->isObject(),"Send a JSON object");return *p;
}
inline std::string text(const Json::Value& b,const char* name,size_t min,size_t max) {
    ensure(b[name].isString(),std::string("Missing ")+name);
    auto value=experts::trim(b[name].asString());
    ensure(value.size()>=min && experts::clean(value,max),std::string("Invalid ")+name);return value;
}
inline void verified(mongocxx::database db,const auth::Identity& who,mongocxx::client_session* s=nullptr) {
    auto u=find(db["users"],objectId(who.id),s);
    ensure(!u.isNull() && u["emailVerified"].asBool(),"Verify your email in Account before continuing.",drogon::k403Forbidden);
    ensure(!u.get("disabled",false).asBool() && !u.get("deleted",false).asBool(),"Account unavailable.",drogon::k403Forbidden);
    if(s){u["workflowFence"]=drogon::utils::getUuid();replace(db["users"],objectId(who.id),u,s);}
}
inline std::string hash(const std::string& value) {
    unsigned char digest[SHA256_DIGEST_LENGTH];SHA256(reinterpret_cast<const unsigned char*>(value.data()),value.size(),digest);
    std::ostringstream out;for(auto c:digest)out<<std::hex<<std::setw(2)<<std::setfill('0')<<int(c);return out.str();
}
template<class F> inline void respond(Callback cb,F fn) {
    try { cb(drogon::HttpResponse::newHttpJsonResponse(fn())); }
    catch(const Error& e){cb(http::error(e.code,e.what()));}
    catch(const auth::Unavailable&){cb(http::error(drogon::k503ServiceUnavailable,"Account service unavailable"));}
    catch(const std::invalid_argument&){cb(http::error(drogon::k401Unauthorized,"Sign in required"));}
    catch(const mongocxx::operation_exception& e){
        LOG_ERROR << "Workflow database error code " << e.code().value();
        cb(http::error(e.code().value()==11000 ? drogon::k409Conflict : drogon::k503ServiceUnavailable,
        e.code().value()==11000 ? "That time was just reserved. Choose another available time." : "Database operation unavailable. Booking requires a MongoDB replica set."));}
    catch(const Json::Exception& e){LOG_ERROR << "Workflow JSON error: " << e.what();cb(http::error(drogon::k503ServiceUnavailable,"The service could not read this record"));}
    catch(const std::exception& e){LOG_ERROR << "Workflow error category: " << typeid(e).name();cb(http::error(drogon::k503ServiceUnavailable,"The service is temporarily unavailable"));}
}
inline Json::Value message(const std::string& text) {Json::Value v;v["message"]=text;return v;}
}

