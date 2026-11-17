#pragma once
#include <drogon/drogon.h>
#include "RuntimeConfig.h"
#include <regex>
namespace client_address {
inline std::string key(const drogon::HttpRequestPtr& req){
    // Enable only behind the isolated production proxy, which overwrites this header.
    if(config::value("TRUST_PROXY_HEADERS")=="true"){
        const auto value=req->getHeader("X-Real-IP");
        if(value.size()<=45 && std::regex_match(value,std::regex("^[0-9a-fA-F:.]+$")))return value;
    }
    return req->peerAddr().toIp();
}
}
