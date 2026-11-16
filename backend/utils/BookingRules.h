#pragma once
#include <cmath>
#include <string>
namespace booking {
constexpr long duration=1800;
inline bool validStart(double start,double now) {
    return std::isfinite(start) && std::floor(start)==start && std::fmod(start,duration)==0 && start>now+300 && start<now+90*86400;
}
inline bool canJoin(const std::string& status,const std::string& mode,double start,double now) {
    return status=="accepted" && (mode=="audio" || mode=="video") && now>=start-600 && now<start+duration;
}
inline bool canDecide(const std::string& status,bool expert,const std::string& action) {
    if(action=="cancel")return status=="requested" || status=="proposed" || status=="accepted";
    if(action=="decline")return expert ? status=="requested" : status=="proposed";
    if(action=="accept")return expert ? status=="requested" : status=="proposed";
    return action=="propose" && expert && (status=="requested" || status=="accepted");
}
}
