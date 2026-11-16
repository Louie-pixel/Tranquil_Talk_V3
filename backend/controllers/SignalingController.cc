#include "SignalingController.h"
#include "../utils/Auth.h"
#include "../utils/Workflow.h"
#include "../utils/BookingRules.h"
#include <json/json.h>
#include <memory>

namespace {
void send(const WebSocketConnectionPtr& conn, const Json::Value& body) {
    Json::StreamWriterBuilder writer; writer["indentation"] = "";
    conn->send(Json::writeString(writer, body));
}
void reject(const WebSocketConnectionPtr& conn, const std::string& message) {
    Json::Value body; body["type"] = "error"; body["error"] = message;
    send(conn, body);
}
struct RoomAccess {auth::Identity identity;std::string userId,label,mode;};
RoomAccess roomAccess(const std::string& token) {
    using namespace workflow;
    auto decoded=jwt::decode(token);
    if(!decoded.has_payload_claim("appointmentId"))return {auth::verify(token,"tranquil-room"),"","Participant",""};
    auto identity=auth::verify(token,"tranquil-appointment");
    const auto userId=decoded.get_payload_claim("userId").as_string();
    auth::currentIdentity(userId);
    auto client=DatabaseManager::getInstance().getConnection();auto db=client->database("tranquil_talk");
    auto a=find(db["appointments"],key(decoded.get_payload_claim("appointmentId").as_string()));
    auto user=find(db["users"],objectId(userId));
    ensure(!user.isNull() && decoded.get_payload_claim("version").as_string()==std::to_string(user.get("sessionVersion",0).asInt()),"Session ended");
    ensure(!a.isNull() && (a["patientId"]==userId || a["expertId"]==userId) && a["roomId"]==identity.id &&
        booking::canJoin(a["status"].asString(),a["mode"].asString(),a["startAt"].asDouble(),now()),"Appointment unavailable");
    ensure(auth::currentIdentity(a["expertId"].asString()).role=="expert","Professional unavailable");
    auto profile=find(db["expert_profiles"],objectId(a["expertId"].asString()));
    return {identity,userId,a["patientId"]==userId ? a["alias"].asString() : profile["name"].asString(),a["mode"].asString()};
}
}

void SignalingController::handleNewConnection(const HttpRequestPtr&, const WebSocketConnectionPtr& conn) {
    conn->setPingMessage("ping", std::chrono::seconds(20));
    // Close sockets which never authenticate. weak_ptr avoids retaining abandoned sockets.
    std::weak_ptr<WebSocketConnection> weak = conn;
    drogon::app().getLoop()->runAfter(10.0, [this, weak] {
        if (auto socket = weak.lock()) {
            bool joined;
            {
                std::lock_guard<std::mutex> lock(roomMutex_);
                joined = members_.find(socket) != members_.end();
            }
            if (!joined) socket->shutdown();
        }
    });
}

void SignalingController::handleConnectionClosed(const WebSocketConnectionPtr& conn) {
    std::vector<WebSocketConnectionPtr> peers;
    {
        std::lock_guard<std::mutex> lock(roomMutex_);
        peers = rooms_.leave(conn);
        members_.erase(conn);
    }
    Json::Value body; body["type"] = "peer_left";
    for (const auto& peer : peers) send(peer, body);
}

void SignalingController::handleNewMessage(const WebSocketConnectionPtr& conn, std::string&& message,
                                           const WebSocketMessageType& type) {
    if (type != WebSocketMessageType::Text) return;
    if (message.size() > 65536) { reject(conn, "Message too large"); conn->shutdown(); return; }
    Json::CharReaderBuilder builder;
    Json::Value body;
    std::string error;
    std::unique_ptr<Json::CharReader> reader(builder.newCharReader());
    if (!reader->parse(message.data(), message.data() + message.size(), &body, &error) ||
        !body.isObject() || !body["type"].isString()) {
        reject(conn, "Invalid signaling message"); return;
    }
    const auto action = body["type"].asString();
    std::vector<WebSocketConnectionPtr> peers;
    if (action == "join") {
        if (!body["ticket"].isString()) { reject(conn, "Room invitation required"); return; }
        try {
            const auto token = body["ticket"].asString();
            const auto access = roomAccess(token);
            if(!access.userId.empty()) {
                if(!body["accessToken"].isString())throw std::invalid_argument("Sign in required");
                const auto bearer=body["accessToken"].asString();
                if(auth::verify(bearer).id!=access.userId)throw std::invalid_argument("Participant mismatch");
                auto decoded=jwt::decode(bearer);
                auto appointmentToken=jwt::decode(token);
                if(!decoded.has_payload_claim("version") || decoded.get_payload_claim("version").as_string()!=appointmentToken.get_payload_claim("version").as_string())
                    throw std::invalid_argument("Session ended");
            }
            const auto identity = access.identity;
            const auto expires = jwt::decode(token).get_expires_at();
            if (identity.role != "participant") throw std::invalid_argument("Invalid ticket");
            {
                std::lock_guard<std::mutex> lock(roomMutex_);
                for(const auto& member:members_) {
                    if(!access.userId.empty() && member.second.room==identity.id && member.second.userId==access.userId) {
                        reject(conn,"You already have this consultation open in another tab.");return;
                    }
                }
                if (!rooms_.join(identity.id, conn)) { reject(conn, "Room is full or unavailable"); return; }
                members_[conn] = {identity.id, expires,token,access.userId,access.label,access.mode};
                peers = rooms_.peers(identity.id, conn);
            }
            Json::Value joined; joined["type"] = "joined";
            joined["roomId"] = identity.id; joined["peers"] = static_cast<int>(peers.size());
            {
                std::lock_guard<std::mutex> lock(roomMutex_);
                for(const auto& peer:peers)joined["peerLabel"]=members_.at(peer).label;
            }
            send(conn, joined);
            Json::Value ready; ready["type"] = "peer_joined";
            ready["peerLabel"]=access.label;
            for (const auto& peer : peers) send(peer, ready);
            std::weak_ptr<WebSocketConnection> weak = conn;
            const auto seconds = std::chrono::duration<double>(expires - std::chrono::system_clock::now()).count();
            drogon::app().getLoop()->runAfter(seconds > 0 ? seconds : 0, [weak] {
                if (auto socket = weak.lock()) socket->shutdown();
            });
            if(!access.userId.empty()) {
                // Recheck cancellation, suspension, deletion and password-reset revocation while connected.
                std::weak_ptr<WebSocketConnection> active=conn;
                auto timer=std::make_shared<trantor::TimerId>();
                *timer=drogon::app().getLoop()->runEvery(10.0,[active,token,timer]{
                    auto socket=active.lock();
                    if(!socket || !socket->connected()){drogon::app().getLoop()->invalidateTimer(*timer);return;}
                    try{roomAccess(token);}catch(const std::exception&){socket->shutdown();drogon::app().getLoop()->invalidateTimer(*timer);}
                });
            }
        } catch (const std::exception&) { reject(conn, "Invitation is invalid or expired"); }
        return;
    }
    if (action != "offer" && action != "answer" && action != "ice_candidate" && action != "hangup") {
        reject(conn, "Unsupported signaling message"); return;
    }
    if (((action == "offer" || action == "answer") &&
         (!body[action].isObject() || !body[action]["sdp"].isString() ||
          !body[action]["type"].isString() || body[action]["type"].asString() != action)) ||
        (action == "ice_candidate" && !body["candidate"].isObject())) {
        reject(conn, "Invalid signaling payload"); return;
    }
    {
        std::string token,mode;
        {
            std::lock_guard<std::mutex> lock(roomMutex_);
            auto member=members_.find(conn);
            if(member!=members_.end()){token=member->second.token;mode=member->second.mode;}
        }
        if(!token.empty()) {
            try{roomAccess(token);}catch(const std::exception&){reject(conn,"Consultation access ended");conn->shutdown();return;}
            if(mode=="audio" && (action=="offer" || action=="answer") && body[action]["sdp"].asString().find("m=video")!=std::string::npos) {
                reject(conn,"This appointment is audio only");conn->shutdown();return;
            }
        }
    }
    {
        std::lock_guard<std::mutex> lock(roomMutex_);
        auto member = members_.find(conn);
        if (member == members_.end() || member->second.expires <= std::chrono::system_clock::now()) {
            reject(conn, "Join a room with a valid invitation first"); return;
        }
        peers = rooms_.peers(member->second.room, conn);
    }
    // Only protocol fields are relayed. A sender cannot inject another room or identity.
    Json::Value outgoing; outgoing["type"] = action;
    if (action == "offer" || action == "answer") outgoing[action] = body[action];
    if (action == "ice_candidate") outgoing["candidate"] = body["candidate"];
    for (const auto& peer : peers) send(peer, outgoing);
}

