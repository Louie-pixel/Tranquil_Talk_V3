#pragma once
#include "Workflow.h"
#include "AppointmentMail.h"
#include <mongocxx/options/find_one_and_update.hpp>
#include <mongocxx/options/return_document.hpp>
#include <algorithm>
#include <atomic>
#include <thread>
namespace mail {
inline std::string mode(){auto value=workflow::env("MAIL_MODE");return value.empty() ? "resend" : value;}
inline bool localMailbox(){
    const auto url=workflow::env("MAILPIT_URL");
    return workflow::env("APP_ENV")=="development" &&
        (url=="http://mailpit:8025" || url=="http://127.0.0.1:8025" || url=="http://localhost:8025");
}
inline bool ready() {return mode()=="outbox" || (mode()=="mailpit" && localMailbox()) ||
    (mode()=="resend" && !workflow::env("RESEND_API_KEY").empty() && !workflow::env("MAIL_FROM").empty());}
inline std::string baseUrl() {
    auto url=workflow::env("APP_BASE_URL");
    workflow::ensure(!url.empty() && url.back()!='/' && (experts::httpsUrl(url) ||
        (workflow::env("APP_ENV")!="production" && std::regex_match(url,std::regex(R"(^http://(localhost|127\.0\.0\.1):[0-9]{1,5}$)")))),"Configure APP_BASE_URL before sending account emails.",drogon::k503ServiceUnavailable);
    return url;
}
inline std::thread start(std::atomic<bool>& running) {
    return std::thread([&running]{
        while(running) {
            if(mode()!="outbox" && ready()) {
                try {
                    auto c=DatabaseManager::getInstance().getConnection();auto db=c->database("tranquil_talk");
                    Json::Value expired;expired["expiresAt"]["$lte"]=workflow::now();workflow::erase(db["mail_outbox"],expired);
                    Json::Value q;q["state"]="pending";q["nextAttempt"]["$lte"]=workflow::now();
                    q["$or"][0]["leaseUntil"]["$exists"]=false;q["$or"][1]["leaseUntil"]["$lte"]=workflow::now();
                    for(auto item:workflow::list(db["mail_outbox"],q,"createdAt",10)) {
                        auto filter=q;filter["_id"]=item["_id"];auto f=workflow::bson(filter);
                        const auto lease=drogon::utils::getUuid();Json::Value change;change["$set"]["lease"]=lease;change["$set"]["leaseUntil"]=workflow::now()+90;change["$inc"]["attempts"]=1;auto update=workflow::bson(change);
                        mongocxx::options::find_one_and_update options;options.return_document(mongocxx::options::return_document::k_after);
                        auto claimed=db["mail_outbox"].find_one_and_update(f.view(),update.view(),options);if(!claimed)continue;item=workflow::decode(claimed->view());
                        auto owned=workflow::key(item["_id"].asString());owned["lease"]=lease;
                        const bool appointment=item.get("kind","")=="appointment";
                        if(appointment && !appointment_mail::resolve(db,item)){workflow::erase(db["mail_outbox"],owned);continue;}
                        const auto subject=appointment ? item["subject"].asString() : "Tranquil Talk: "+item["purpose"].asString();
                        const auto text=appointment ? item["text"].asString()+"\n"+baseUrl()+"/#appointments" : "You requested an account action for Tranquil Talk. Open this link within 30 minutes: "+item["url"].asString()+"\nIf this was not you, ignore this email.";
                        Json::Value payload;
                        const bool development=mode()=="mailpit";
                        if(development){
                            payload["From"]["Email"]="no-reply@tranquil.local";payload["From"]["Name"]="Tranquil Talk (local development)";
                            payload["To"][0]["Email"]=item["to"];payload["Subject"]=subject;payload["Text"]=text;
                            payload["Headers"]["Message-ID"]="<"+workflow::hash(item["_id"].asString())+"@tranquil.local>";
                        }else{payload["from"]=workflow::env("MAIL_FROM");payload["to"][0]=item["to"];payload["subject"]=subject;payload["text"]=text;}
                        auto request=drogon::HttpRequest::newHttpJsonRequest(payload);request->setMethod(drogon::Post);request->setPath(development ? "/api/v1/send" : "/emails");
                        if(!development)request->addHeader("Authorization","Bearer "+workflow::env("RESEND_API_KEY"));
                        // A stable idempotency key prevents duplicate sends after a lost acknowledgement.
                        request->addHeader("Idempotency-Key",item["_id"].asString());
                        auto client=drogon::HttpClient::newHttpClient(development ? workflow::env("MAILPIT_URL") : "https://api.resend.com");
                        auto response=client->sendRequest(request,15);
                        if(response.first==drogon::ReqResult::Ok && response.second && response.second->statusCode()>=200 && response.second->statusCode()<300)
                            workflow::erase(db["mail_outbox"],owned);
                        else {
                            if(appointment){item.removeMember("to");item.removeMember("text");item.removeMember("subject");}
                            const auto attempts=item.get("attempts",1).asInt();item["nextAttempt"]=workflow::now()+std::min(3600,30*(1<<std::min(attempts,7)));
                            if(attempts>=8)item["state"]="failed";
                            item.removeMember("lease");item.removeMember("leaseUntil");workflow::replace(db["mail_outbox"],owned,item);
                        }
                    }
                }catch(const std::exception&){ /* No credentials, addresses or action links in logs. Retry later. */ }
            }
            for(int i=0;i<50 && running;++i)std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
    });
}
struct Worker {
    std::atomic<bool> running{true};
    std::thread thread;
    Worker() : thread(start(running)) {}
    ~Worker() {running=false;if(thread.joinable())thread.join();}
};
}
