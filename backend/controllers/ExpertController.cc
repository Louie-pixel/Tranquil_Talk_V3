#include "ExpertController.h"
#include "../utils/Auth.h"
#include "../utils/Http.h"
#include "../utils/ExpertRules.h"
#include "../utils/RateLimit.h"
#include "../utils/Validation.h"
#include "../models/DatabaseManager.h"
#include <bsoncxx/json.hpp>
#include <bsoncxx/builder/stream/document.hpp>
#include <bsoncxx/exception/exception.hpp>
#include <bsoncxx/oid.hpp>
#include <mongocxx/client.hpp>
#include <mongocxx/database.hpp>
#include <mongocxx/collection.hpp>
#include <mongocxx/pipeline.hpp>
#include <mongocxx/options/find.hpp>
#include <mongocxx/exception/operation_exception.hpp>
#include <memory>

namespace {
using Callback = ExpertController::Callback;
std::string write(const Json::Value& value) {
    Json::StreamWriterBuilder builder; builder["indentation"] = "";
    return Json::writeString(builder, value);
}
Json::Value read(bsoncxx::document::view value) {
    const auto text = bsoncxx::to_json(value);
    Json::CharReaderBuilder builder;
    Json::Value result; std::string error;
    std::unique_ptr<Json::CharReader> reader(builder.newCharReader());
    if (!reader->parse(text.data(), text.data() + text.size(), &result, &error))
        throw std::runtime_error("Profile conversion failed");
    result["id"] = value["_id"].get_oid().value.to_string();
    result.removeMember("_id");
    return result;
}
std::string now() {
    return trantor::Date::now().toCustomFormattedString("%Y-%m-%dT%H:%M:%SZ", false);
}
bsoncxx::document::value idFilter(const std::string& id) {
    using namespace bsoncxx::builder::stream;
    return document{} << "_id" << bsoncxx::oid(id) << finalize;
}
Json::Value publicProfile(const Json::Value& source) {
    Json::Value result;
    for (const auto* key : {"id", "name", "professionalTitle", "bio", "city", "country",
        "practiceName", "website", "yearsExperience", "specialties", "languages",
        "qualifications", "methods"}) result[key] = source[key];
    result["verifiedAt"] = source["approvedAt"];
    result["verificationLabel"] = "Registration reviewed";
    return result;
}
Json::Value privateProfile(Json::Value source, bool admin = false) {
    if (!admin && source["reviews"].isArray()) {
        for (auto& item : source["reviews"]) item.removeMember("reviewerId");
    }
    return source;
}
bool identity(const drogon::HttpRequestPtr& req, Callback& callback, auth::Identity& who, bool admin = false) {
    try { who = auth::require(req); }
    catch (const auth::Unavailable&) {
        callback(http::error(drogon::k503ServiceUnavailable, "Account access is temporarily unavailable")); return false;
    } catch (const std::exception&) {
        callback(http::error(drogon::k401Unauthorized, "Sign in required")); return false;
    }
    if (admin ? who.role != "admin" : (who.role != "expert" && who.role != "expert_pending")) {
        callback(http::error(drogon::k403Forbidden, admin ? "Administrator access required" : "Professional account required"));
        return false;
    }
    return true;
}
Json::Value content(const Json::Value& body, bool complete) {
    Json::Value result;
    const std::vector<std::pair<std::string, unsigned>> strings = {
        {"name",100},{"professionalTitle",120},{"bio",3000},{"city",100},{"country",100},
        {"practiceName",160},{"website",512},{"registrationBody",160},
        {"registrationNumber",100},{"registrationCountry",100},{"credentialReference",512}
    };
    for (const auto& entry : strings) {
        const auto& value = body[entry.first];
        if (!value.isNull() && !value.isString()) throw std::invalid_argument("Profile text fields must be strings");
        const auto text = experts::trim(value.isString() ? value.asString() : "");
        if (!experts::clean(text, entry.second)) throw std::invalid_argument("A profile field is too long or contains invalid characters");
        result[entry.first] = text;
    }
    if (!result["website"].asString().empty() && !experts::httpsUrl(result["website"].asString()))
        throw std::invalid_argument("Practice website must be a valid HTTPS URL");
    if (!result["credentialReference"].asString().empty() && !experts::httpsUrl(result["credentialReference"].asString()))
        throw std::invalid_argument("Registration reference must be a valid HTTPS URL");
    for (const auto& field : {"specialties", "languages", "qualifications", "methods"}) {
        result[field] = Json::Value(Json::arrayValue);
        const auto& values = body[field];
        if (!values.isNull() && !values.isArray()) throw std::invalid_argument("Profile lists must be arrays");
        if (values.size() > 8) throw std::invalid_argument("Choose up to eight items per profile list");
        for (const auto& value : values) {
            if (!value.isString()) throw std::invalid_argument("Profile list items must be text");
            const auto text = experts::trim(value.asString());
            if (text.empty() || !experts::clean(text, std::string(field) == "qualifications" ? 180 : 60))
                throw std::invalid_argument("A profile list item is invalid");
            if (std::string(field) == "specialties" && !experts::contains(experts::specialties(), text))
                throw std::invalid_argument("Choose a supported specialty");
            if (std::string(field) == "methods" &&
                !experts::contains({"audio","video","in_person"}, text))
                throw std::invalid_argument("Choose audio, video or in-person consultations");
            for (const auto& existing : result[field])
                if (existing.asString() == text) throw std::invalid_argument("Remove duplicate list items");
            result[field].append(text);
        }
    }
    if (body.isMember("yearsExperience") && (!body["yearsExperience"].isInt() ||
        body["yearsExperience"].asInt() < 0 || body["yearsExperience"].asInt() > 80))
        throw std::invalid_argument("Years of experience must be an integer from 0 to 80");
    result["yearsExperience"] = body.get("yearsExperience", 0);
    if (complete) {
        for (const auto* field : {"name","professionalTitle","city","country",
             "registrationBody","registrationNumber","registrationCountry","credentialReference"})
            if (result[field].asString().empty()) throw std::invalid_argument("Complete your public profile and registration details before submitting");
        if (result["bio"].asString().size() < 80)
            throw std::invalid_argument("Write a professional biography of at least 80 bytes");
        for (const auto* field : {"specialties","languages","qualifications","methods"})
            if (result[field].empty()) throw std::invalid_argument("Add specialties, languages, qualifications and consultation methods");
    }
    return result;
}
void validateKeys(const Json::Value& body) {
    const std::vector<std::string> allowed = {"revision","name","professionalTitle","bio","city","country",
        "practiceName","website","yearsExperience","specialties","languages","qualifications","methods",
        "registrationBody","registrationNumber","registrationCountry","credentialReference"};
    if (!body.isObject()) throw std::invalid_argument("A profile object is required");
    for (const auto& key : body.getMemberNames())
        if (!experts::contains(allowed, key)) throw std::invalid_argument("Profile contains an unsupported field");
}
int revision(const Json::Value& body, bool allowZero = false) {
    if (!body["revision"].isInt() || body["revision"].asInt() < (allowZero ? 0 : 1) ||
        body["revision"].asInt() > 1000000000)
        throw std::invalid_argument("A valid profile revision is required");
    return body["revision"].asInt();
}
int offset(const drogon::HttpRequestPtr& req) {
    const auto text = req->getParameter("offset");
    if (text.empty()) return 0;
    const auto value = validation::number(text,0,10000);
    if (value != static_cast<int>(value)) throw std::invalid_argument("Invalid offset");
    return static_cast<int>(value);
}
void unavailable(Callback& callback) {
    callback(http::error(drogon::k503ServiceUnavailable, "Professional profiles are temporarily unavailable"));
}
}

void ExpertController::directory(const drogon::HttpRequestPtr& req, Callback&& callback) {
    Json::Value filter;
    int skip;
    try {
        skip = offset(req);
        const auto search = experts::trim(req->getParameter("q"));
        const auto specialty = req->getParameter("specialty");
        const auto language = experts::trim(req->getParameter("language"));
        const auto method = req->getParameter("method");
        if (!experts::clean(search,80) || !experts::clean(language,60) ||
            (!specialty.empty() && !experts::contains(experts::specialties(),specialty)) ||
            (!method.empty() && !experts::contains({"audio","video","in_person"},method)))
            throw std::invalid_argument("Invalid expert search filter");
        filter["status"] = "approved";
        filter["$expr"]["$eq"] = Json::Value(Json::arrayValue);
        filter["$expr"]["$eq"].append("$approvedRevision");
        filter["$expr"]["$eq"].append("$revision");
        if (!specialty.empty()) filter["specialties"] = specialty;
        if (!method.empty()) filter["methods"] = method;
        if (!language.empty()) {
            filter["languages"]["$regex"] = "^" + experts::escapeRegex(language) + "$";
            filter["languages"]["$options"] = "i";
        }
        if (!search.empty()) {
            filter["$or"] = Json::Value(Json::arrayValue);
            for (const auto* field : {"name","professionalTitle","city","practiceName","specialties"}) {
                Json::Value term;
                term[field]["$regex"] = experts::escapeRegex(search);
                term[field]["$options"] = "i";
                filter["$or"].append(term);
            }
        }
    } catch (const std::exception&) {
        callback(http::error(drogon::k400BadRequest, "Use valid search filters and a whole-number offset from 0 to 10000")); return;
    }
    try {
        auto client = DatabaseManager::getInstance().getConnection();
        auto profiles = client->database("tranquil_talk").collection("expert_profiles");
        mongocxx::pipeline pipeline;
        Json::Value stage;
        stage["$match"] = filter; pipeline.append_stage(bsoncxx::from_json(write(stage)));
        stage = Json::Value(); stage["$lookup"]["from"] = "users";
        stage["$lookup"]["localField"] = "_id"; stage["$lookup"]["foreignField"] = "_id";
        stage["$lookup"]["as"] = "account"; pipeline.append_stage(bsoncxx::from_json(write(stage)));
        stage = Json::Value(); stage["$match"]["account.role"] = "expert";
        pipeline.append_stage(bsoncxx::from_json(write(stage)));
        stage = Json::Value(); stage["$sort"]["name"] = 1; stage["$sort"]["_id"] = 1;
        pipeline.append_stage(bsoncxx::from_json(write(stage)));
        stage = Json::Value(); stage["$skip"] = skip; pipeline.append_stage(bsoncxx::from_json(write(stage)));
        stage = Json::Value(); stage["$limit"] = 21; pipeline.append_stage(bsoncxx::from_json(write(stage)));
        // Exclude account hashes/emails and credential/review material before returning any document.
        stage = Json::Value();
        for (const auto* key : {"_id","name","professionalTitle","bio","city","country","practiceName",
             "website","yearsExperience","specialties","languages","qualifications","methods","approvedAt"})
            stage["$project"][key] = 1;
        pipeline.append_stage(bsoncxx::from_json(write(stage)));
        Json::Value result; result["items"] = Json::Value(Json::arrayValue);
        result["nextOffset"] = Json::Value();
        for (auto&& value : profiles.aggregate(pipeline)) {
            if (result["items"].size() == 20) { if (skip < 10000) result["nextOffset"] = skip + 20; break; }
            result["items"].append(publicProfile(read(value)));
        }
        callback(drogon::HttpResponse::newHttpJsonResponse(result));
    } catch (const std::exception&) { unavailable(callback); }
}

void ExpertController::detail(const drogon::HttpRequestPtr&, Callback&& callback, std::string id) {
    try {
        const auto filter = idFilter(id);
        auto client = DatabaseManager::getInstance().getConnection();
        auto db = client->database("tranquil_talk");
        auto found = db.collection("expert_profiles").find_one(filter.view());
        auto user = db.collection("users").find_one(filter.view());
        if (!found || !user || std::string(user->view()["role"].get_string().value) != "expert") {
            callback(http::error(drogon::k404NotFound, "Professional profile not found")); return;
        }
        const auto data = read(found->view());
        if (!experts::approved(data["status"].asString(), data["revision"].asInt(), data["approvedRevision"].asInt())) {
            callback(http::error(drogon::k404NotFound, "Professional profile not found")); return;
        }
        callback(drogon::HttpResponse::newHttpJsonResponse(publicProfile(data)));
    } catch (const bsoncxx::exception&) {
        callback(http::error(drogon::k404NotFound, "Professional profile not found"));
    } catch (const std::exception&) { unavailable(callback); }
}

void ExpertController::mine(const drogon::HttpRequestPtr& req, Callback&& callback) {
    auth::Identity who; if (!identity(req,callback,who)) return;
    try {
        auto client = DatabaseManager::getInstance().getConnection();
        auto found = client->database("tranquil_talk").collection("expert_profiles").find_one(idFilter(who.id));
        Json::Value result; result["profile"] = found ? privateProfile(read(found->view())) : Json::Value();
        callback(drogon::HttpResponse::newHttpJsonResponse(result));
    } catch (const std::exception&) { unavailable(callback); }
}

void ExpertController::save(const drogon::HttpRequestPtr& req, Callback&& callback) {
    auth::Identity who; if (!identity(req,callback,who)) return;
    if (!rate_limit::allow(who.id + ":profile-save",20)) {
        callback(http::error(drogon::k429TooManyRequests,"Please try again in a minute")); return;
    }
    Json::Value data; int expected;
    try {
        const auto body = req->getJsonObject();
        if (!body) throw std::invalid_argument("A profile is required");
        validateKeys(*body); expected = revision(*body,true); data = content(*body,false);
    } catch (const std::exception& error) {
        callback(http::error(drogon::k400BadRequest,error.what())); return;
    }
    try {
        auto client = DatabaseManager::getInstance().getConnection();
        auto profiles = client->database("tranquil_talk").collection("expert_profiles");
        auto found = profiles.find_one(idFilter(who.id));
        if (found && read(found->view())["status"].asString() == "suspended") {
            callback(http::error(drogon::k403Forbidden,"This profile is suspended. An administrator must reopen it.")); return;
        }
        data["status"] = "draft"; data["updatedAt"] = now();
        if (!found && expected == 0) {
            data["createdAt"] = data["updatedAt"]; data["revision"] = 1;
            data["reviews"] = Json::Value(Json::arrayValue);
            data["_id"]["$oid"] = who.id;
            profiles.insert_one(bsoncxx::from_json(write(data)));
        } else {
            Json::Value filter; filter["_id"]["$oid"] = who.id;
            filter["revision"] = expected; filter["status"]["$ne"] = "suspended";
            Json::Value update; update["$set"] = data; update["$inc"]["revision"] = 1;
            const auto result = profiles.update_one(bsoncxx::from_json(write(filter)),bsoncxx::from_json(write(update)));
            if (!result || result->matched_count() != 1) {
                callback(http::error(drogon::k409Conflict,"Profile changed. Refresh before saving again.")); return;
            }
        }
        auto saved = profiles.find_one(idFilter(who.id));
        Json::Value result; result["profile"] = privateProfile(read(saved->view()));
        callback(drogon::HttpResponse::newHttpJsonResponse(result));
    } catch (const mongocxx::operation_exception& error) {
        if (error.code().value() == 11000)
            callback(http::error(drogon::k409Conflict,"Profile already exists. Refresh before saving."));
        else unavailable(callback);
    } catch (const std::exception&) { unavailable(callback); }
}

void ExpertController::submit(const drogon::HttpRequestPtr& req, Callback&& callback) {
    auth::Identity who; if (!identity(req,callback,who)) return;
    if (!rate_limit::allow(who.id + ":profile-submit",5)) {
        callback(http::error(drogon::k429TooManyRequests,"Please try again in a minute")); return;
    }
    int expected;
    try {
        const auto body = req->getJsonObject();
        if (!body || !body->isObject()) throw std::invalid_argument("Profile revision required");
        expected = revision(*body);
    } catch (const std::exception& error) {
        callback(http::error(drogon::k400BadRequest,error.what())); return;
    }
    try {
        auto client = DatabaseManager::getInstance().getConnection();
        auto profiles = client->database("tranquil_talk").collection("expert_profiles");
        auto found = profiles.find_one(idFilter(who.id));
        if (!found) { callback(http::error(drogon::k404NotFound,"Save a profile first")); return; }
        auto profile = read(found->view());
        if (profile["revision"].asInt() != expected || !experts::canSubmit(profile["status"].asString())) {
            callback(http::error(drogon::k409Conflict,"Refresh the profile before submitting. Only drafts or changes requested can be submitted.")); return;
        }
        try { content(profile,true); }
        catch (const std::exception& error) { callback(http::error(drogon::k400BadRequest,error.what())); return; }
        Json::Value filter; filter["_id"]["$oid"] = who.id; filter["revision"] = expected;
        filter["status"] = profile["status"];
        Json::Value update; update["$set"]["status"] = "pending";
        update["$set"]["submittedAt"] = now(); update["$set"]["updatedAt"] = now();
        update["$inc"]["revision"] = 1;
        auto result = profiles.update_one(bsoncxx::from_json(write(filter)),bsoncxx::from_json(write(update)));
        if (!result || result->matched_count() != 1) {
            callback(http::error(drogon::k409Conflict,"Profile changed. Refresh before submitting.")); return;
        }
        auto saved = profiles.find_one(idFilter(who.id));
        Json::Value response; response["profile"] = privateProfile(read(saved->view()));
        callback(drogon::HttpResponse::newHttpJsonResponse(response));
    } catch (const std::exception&) { unavailable(callback); }
}

void ExpertController::queue(const drogon::HttpRequestPtr& req, Callback&& callback) {
    auth::Identity who; if (!identity(req,callback,who,true)) return;
    const auto requested = req->getParameter("status").empty() ? "pending" : req->getParameter("status");
    int skip;
    try {
        skip = offset(req);
        if (!experts::contains({"pending","approved","changes_requested","suspended","draft"}, requested))
            throw std::invalid_argument("Invalid status");
    } catch (const std::exception&) {
        callback(http::error(drogon::k400BadRequest,"Choose a valid review status and offset")); return;
    }
    try {
        auto client = DatabaseManager::getInstance().getConnection();
        auto profiles = client->database("tranquil_talk").collection("expert_profiles");
        Json::Value filter; filter["status"] = requested;
        Json::Value sort; sort["updatedAt"] = -1; sort["_id"] = 1;
        mongocxx::options::find options; options.limit(21); options.skip(skip);
        options.sort(bsoncxx::from_json(write(sort)));
        Json::Value projection;
        for (const auto* key : {"_id","name","professionalTitle","city","country","status","revision","updatedAt"}) projection[key] = 1;
        options.projection(bsoncxx::from_json(write(projection)));
        Json::Value result; result["items"] = Json::Value(Json::arrayValue); result["nextOffset"] = Json::Value();
        for (auto&& value : profiles.find(bsoncxx::from_json(write(filter)),options)) {
            if (result["items"].size() == 20) { if (skip < 10000) result["nextOffset"] = skip + 20; break; }
            result["items"].append(privateProfile(read(value),true));
        }
        callback(drogon::HttpResponse::newHttpJsonResponse(result));
    } catch (const std::exception&) { unavailable(callback); }
}

void ExpertController::reviewDetail(const drogon::HttpRequestPtr& req, Callback&& callback, std::string id) {
    auth::Identity who; if (!identity(req,callback,who,true)) return;
    try {
        const auto filter = idFilter(id);
        auto client = DatabaseManager::getInstance().getConnection();
        auto found = client->database("tranquil_talk").collection("expert_profiles").find_one(filter.view());
        if (!found) { callback(http::error(drogon::k404NotFound,"Professional profile not found")); return; }
        Json::Value result; result["profile"] = privateProfile(read(found->view()),true);
        callback(drogon::HttpResponse::newHttpJsonResponse(result));
    } catch (const bsoncxx::exception&) {
        callback(http::error(drogon::k404NotFound,"Professional profile not found"));
    } catch (const std::exception&) { unavailable(callback); }
}

void ExpertController::review(const drogon::HttpRequestPtr& req, Callback&& callback, std::string id) {
    auth::Identity who; if (!identity(req,callback,who,true)) return;
    if (id == who.id) { callback(http::error(drogon::k403Forbidden,"You cannot review your own profile")); return; }
    if (!rate_limit::allow(who.id + ":profile-review",30)) {
        callback(http::error(drogon::k429TooManyRequests,"Please try again in a minute")); return;
    }
    int expected; std::string action,note,reference; bool registryChecked = false;
    try {
        idFilter(id);
        const auto body = req->getJsonObject();
        if (!body || !body->isObject() || !(*body)["action"].isString() || !(*body)["note"].isString())
            throw std::invalid_argument("Review action and note are required");
        expected = revision(*body);
        action = (*body)["action"].asString(); note = experts::trim((*body)["note"].asString());
        if (!experts::contains({"approve","request_changes","suspend"}, action) ||
            note.size() < 10 || !experts::clean(note,1000)) throw std::invalid_argument("Add a review note of 10 to 1000 bytes");
        if (action == "approve") {
            registryChecked = (*body)["registryChecked"].isBool() && (*body)["registryChecked"].asBool();
            if (!(*body)["reference"].isString()) throw std::invalid_argument("Record the official registry URL you checked");
            reference = (*body)["reference"].asString();
            if (!registryChecked || !experts::httpsUrl(reference))
                throw std::invalid_argument("Confirm the registration check and record its official HTTPS registry URL");
        }
    } catch (const std::exception& error) {
        callback(http::error(drogon::k400BadRequest,error.what())); return;
    }
    try {
        auto client = DatabaseManager::getInstance().getConnection();
        auto db = client->database("tranquil_talk");
        auto profiles = db.collection("expert_profiles");
        auto found = profiles.find_one(idFilter(id));
        auto user = db.collection("users").find_one(idFilter(id));
        if (!found || !user) { callback(http::error(drogon::k404NotFound,"Professional profile not found")); return; }
        auto profile = read(found->view());
        const auto currentStatus = profile["status"].asString();
        const std::string role(user->view()["role"].get_string().value);
        if (profile["revision"].asInt() != expected || !experts::canReview(currentStatus,action)) {
            callback(http::error(drogon::k409Conflict,"This application changed. Refresh before reviewing.")); return;
        }
        if ((role != "expert" && role != "expert_pending") || profile["reviews"].size() >= 1000) {
            callback(http::error(drogon::k409Conflict,"This account requires operator attention before review")); return;
        }
        if (action == "approve") {
            try { content(profile,true); }
            catch (const std::exception&) { callback(http::error(drogon::k400BadRequest,"The profile is incomplete")); return; }
            Json::Value roleFilter; roleFilter["_id"]["$oid"] = id; roleFilter["role"] = role;
            Json::Value roleUpdate; roleUpdate["$set"]["role"] = "expert";
            auto changed = db.collection("users").update_one(bsoncxx::from_json(write(roleFilter)),bsoncxx::from_json(write(roleUpdate)));
            if (!changed || changed->matched_count() != 1) {
                callback(http::error(drogon::k409Conflict,"Account access changed. Refresh before reviewing.")); return;
            }
            // Access still requires the exact approved profile revision. This ordering fails closed
            // on a database failure or concurrent edit, without requiring a replica-set transaction.
        }
        const auto time = now();
        Json::Value filter; filter["_id"]["$oid"] = id; filter["revision"] = expected; filter["status"] = currentStatus;
        Json::Value update;
        update["$set"]["status"] = action == "approve" ? "approved" : action == "suspend" ? "suspended" : "changes_requested";
        update["$set"]["updatedAt"] = time; update["$inc"]["revision"] = 1;
        if (action == "approve") {
            update["$set"]["approvedAt"] = time; update["$set"]["approvedRevision"] = expected + 1;
        }
        Json::Value review;
        review["action"] = action; review["note"] = note; review["reference"] = reference;
        review["registryChecked"] = registryChecked; review["reviewerId"] = who.id;
        review["reviewedRevision"] = expected; review["previousStatus"] = currentStatus; review["at"] = time;
        update["$push"]["reviews"] = review; // Decision, revision and audit entry are one atomic document update.
        auto changed = profiles.update_one(bsoncxx::from_json(write(filter)),bsoncxx::from_json(write(update)));
        if (!changed || changed->matched_count() != 1) {
            callback(http::error(drogon::k409Conflict,"This application changed. Refresh before reviewing.")); return;
        }
        auto saved = profiles.find_one(idFilter(id));
        Json::Value result; result["profile"] = privateProfile(read(saved->view()),true);
        callback(drogon::HttpResponse::newHttpJsonResponse(result));
    } catch (const std::exception&) { unavailable(callback); }
}
