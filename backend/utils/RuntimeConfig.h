#pragma once
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
namespace config {
// Docker secrets may be mounted as files; never include their values in diagnostics.
inline std::string value(const std::string& name,const std::string& fallback="") {
    const char* file=std::getenv((name+"_FILE").c_str());
    const char* direct=std::getenv(name.c_str());
    if(file && *file){
        if(direct && *direct)throw std::runtime_error("Configure either a value or a secret file");
        std::ifstream in(file,std::ios::binary);
        if(!in)throw std::runtime_error("Secret file unavailable");
        std::ostringstream out;out<<in.rdbuf();auto result=out.str();
        if(result.size()>16384)throw std::runtime_error("Secret file too large");
        while(!result.empty() && (result.back()=='\n' || result.back()=='\r'))result.pop_back();
        if(result.empty())throw std::runtime_error("Secret file empty");
        return result;
    }
    return direct ? direct : fallback;
}
}
