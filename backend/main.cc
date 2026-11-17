#include <drogon/drogon.h>
#include "models/DatabaseManager.h"
#include "utils/Auth.h"
#include "utils/Validation.h"
#include "utils/Mail.h"
#include <cstdlib>
#include <iostream>

namespace {
std::string env(const char* name, const std::string& fallback) {
    return config::value(name,fallback);
}
}
int main(int argc, char* argv[]) {
    if (argc != 1 && !(argc == 3 && std::string(argv[1]) == "--grant-admin")) {
        std::cerr << "Usage: TranquilBackend [--grant-admin existing-account-email]\n";
        return 2;
    }
    try {
        auth::secret(); // Fail closed before opening a listening socket.
        if(env("APP_ENV","")=="production") {
            if(mail::mode()!="resend" || !mail::ready() || mail::baseUrl().rfind("https://",0)!=0)
                throw std::runtime_error("Configure production email and HTTPS origin");
            const auto mongo=env("MONGODB_URI","");
            if(mongo.find('@')==std::string::npos || env("TURN_SECRET","").size()<32 ||
               !std::regex_match(env("TURN_URL",""),std::regex(R"(^turns?:[^\s]+$)")))
                throw std::runtime_error("Configure authenticated MongoDB and TURN relay");
        }
        DatabaseManager::getInstance().init(env("MONGODB_URI",
            "mongodb://localhost:27017/?serverSelectionTimeoutMS=5000"));
        if (argc == 3) {
            const auto email = validation::email(argv[2]);
            if (!validation::validEmail(email)) throw std::invalid_argument("Invalid account email");
            auto connection = DatabaseManager::getInstance().getConnection();
            using namespace bsoncxx::builder::stream;
            auto result = connection->database("tranquil_talk").collection("users").update_one(
                document{} << "email" << email << finalize,
                document{} << "$set" << open_document << "role" << "admin" << close_document << finalize);
            if (!result || result->matched_count() != 1) {
                std::cerr << "No existing account matched. Create the operator account first.\n";
                return 2;
            }
            std::cout << "Administrator access granted. Sign in and open Verification.\n";
            return 0;
        }
        const auto port = validation::number(env("PORT", "8080"), 1, 65535);
        if (port != static_cast<int>(port)) throw std::invalid_argument("PORT must be an integer");
        mail::Worker mailWorker;
        drogon::app()
            .setDocumentRoot(env("WEB_ROOT", "web"))
            .setUploadPath(env("UPLOAD_PATH", "/tmp/tranquil-talk-uploads"))
            .setClientMaxBodySize(65536)
            .setClientMaxWebSocketMessageSize(65536)
            .setThreadNum(2)
            .registerHandler("/api/health",[](const drogon::HttpRequestPtr&,std::function<void(const drogon::HttpResponsePtr&)>&& callback){
                Json::Value result;result["service"]="tranquil-talk";
                try{
                    auto client=DatabaseManager::getInstance().getConnection();
                    using namespace bsoncxx::builder::stream;
                    client->database("tranquil_talk").run_command(document{} << "ping" << 1 << finalize);
                    result["ready"]=true;result["database"]="connected";
                    callback(drogon::HttpResponse::newHttpJsonResponse(result));
                }catch(const std::exception&){
                    result["ready"]=false;result["database"]="unavailable";
                    auto response=drogon::HttpResponse::newHttpJsonResponse(result);response->setStatusCode(drogon::k503ServiceUnavailable);callback(response);
                }
            },{drogon::Get})
            .registerPreSendingAdvice([](const drogon::HttpRequestPtr&, const drogon::HttpResponsePtr& res) {
                res->addHeader("X-Content-Type-Options", "nosniff");
                res->addHeader("Referrer-Policy", "no-referrer");
                res->addHeader("Cache-Control", "no-store");
                res->addHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(self)");
                res->addHeader("Content-Security-Policy",
                    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
                    "connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
            })
            .addListener(env("BIND_ADDRESS", "127.0.0.1"), static_cast<unsigned short>(port))
            .run();
    } catch (const std::exception&) {
        // Avoid logging database credentials from driver exception messages.
        std::cerr << "Startup failed. Check secret files, JWT_SECRET, production email/HTTPS/TURN, MongoDB replica set/authentication, PORT and WEB_ROOT.\n";
        return 1;
    }
}
