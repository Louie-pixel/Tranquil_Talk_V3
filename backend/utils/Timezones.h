#pragma once
#include "Workflow.h"
#include <unicode/ucal.h>
#include <unicode/udat.h>
#include <unicode/ustring.h>
#include <unicode/uenum.h>
#include <memory>
#include <regex>
#include <cmath>
namespace timezones {
inline std::u16string unicode(const std::string& value){
    UChar buffer[256];int32_t size=0;UErrorCode error=U_ZERO_ERROR;
    u_strFromUTF8(buffer,256,&size,value.c_str(),static_cast<int32_t>(value.size()),&error);
    workflow::ensure(U_SUCCESS(error),"Invalid timezone");
    return std::u16string(reinterpret_cast<char16_t*>(buffer),size);
}
inline std::string validate(const std::string& zone){
    workflow::ensure(!zone.empty() && zone.size()<100,"Choose a named timezone such as Africa/Johannesburg");
    auto input=unicode(zone);UChar canonical[256];UBool system=false;UErrorCode error=U_ZERO_ERROR;
    ucal_getCanonicalTimeZoneID(reinterpret_cast<const UChar*>(input.c_str()),static_cast<int32_t>(input.size()),canonical,256,&system,&error);
    workflow::ensure(U_SUCCESS(error) && system && zone!="Etc/Unknown","Choose a recognised IANA timezone");return zone;
}
inline std::string forUser(const Json::Value& u){return validate(u["timeZone"].isString() ? u["timeZone"].asString() : "UTC");}
inline Json::Value describe(double seconds,const std::string& zone){
    auto z=unicode(validate(zone));UErrorCode error=U_ZERO_ERROR;
    const auto pattern=unicode("yyyy-MM-dd'T'HH:mm:ssXXX");
    std::unique_ptr<UDateFormat,decltype(&udat_close)> format(udat_open(UDAT_PATTERN,UDAT_PATTERN,"en_GB",reinterpret_cast<const UChar*>(z.c_str()),static_cast<int32_t>(z.size()),reinterpret_cast<const UChar*>(pattern.c_str()),static_cast<int32_t>(pattern.size()),&error),udat_close);
    workflow::ensure(U_SUCCESS(error),"Time formatter unavailable",drogon::k503ServiceUnavailable);
    UChar buffer[256];auto length=udat_format(format.get(),seconds*1000,buffer,256,nullptr,&error);
    char utf8[1024];int32_t size=0;u_strToUTF8(utf8,1024,&size,buffer,length,&error);
    workflow::ensure(U_SUCCESS(error),"Time formatter unavailable",drogon::k503ServiceUnavailable);
    Json::Value out;out["timeZone"]=zone;out["localStart"]=std::string(utf8,size);out["startAt"]=seconds;return out;
}
inline double start(const Json::Value& b,const std::string& fallback){
    const auto zone=validate(b.isMember("timeZone") ? workflow::text(b,"timeZone",1,99) : fallback);
    workflow::ensure(!(b.isMember("localStart") && b.isMember("startAt")),"Send either UTC startAt or localStart, not both");
    if(!b.isMember("localStart")){
        workflow::ensure(b["startAt"].isNumeric(),"Send a UTC epoch startAt or a localStart and named timezone");
        const auto result=b["startAt"].asDouble();workflow::ensure(std::isfinite(result),"Invalid time");return result;
    }
    workflow::ensure(b.isMember("timeZone"),"A named timezone is required for localStart");
    std::smatch m;const auto local=workflow::text(b,"localStart",16,16);
    workflow::ensure(std::regex_match(local,m,std::regex(R"(^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$)")),"Use YYYY-MM-DDTHH:mm for localStart");
    auto z=unicode(zone);
    auto convert=[&](int option){
        UErrorCode error=U_ZERO_ERROR;
        std::unique_ptr<UCalendar,decltype(&ucal_close)> c(ucal_open(reinterpret_cast<const UChar*>(z.c_str()),static_cast<int32_t>(z.size()),"en_GB",UCAL_GREGORIAN,&error),ucal_close);
        workflow::ensure(U_SUCCESS(error),"Timezone service unavailable",drogon::k503ServiceUnavailable);
        ucal_clear(c.get());ucal_setAttribute(c.get(),UCAL_LENIENT,0);ucal_setAttribute(c.get(),UCAL_REPEATED_WALL_TIME,option);
        ucal_setDateTime(c.get(),std::stoi(m[1]),std::stoi(m[2])-1,std::stoi(m[3]),std::stoi(m[4]),std::stoi(m[5]),0,&error);
        const auto result=ucal_getMillis(c.get(),&error)/1000;
        workflow::ensure(U_SUCCESS(error),"This local time is invalid or skipped by a daylight-saving change. Choose another time.");return result;
    };
    const auto first=convert(UCAL_WALLTIME_FIRST),last=convert(UCAL_WALLTIME_LAST);
    const auto choice=b.get("occurrence","").asString();
    workflow::ensure(choice.empty() || choice=="earlier" || choice=="later","Choose earlier or later for occurrence");
    workflow::ensure(first==last || !choice.empty(),"This local time occurs twice. Send occurrence: earlier or later.");
    return choice=="later" ? last : first;
}
}
