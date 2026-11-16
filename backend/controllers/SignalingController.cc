#include "SignalingController.h"
#include "../utils/Auth.h"
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
}

void SignalingController::handleNewConnection(const HttpRequestPtr&, const WebSocketConnectionPtr& conn) {
    conn->setPingMessage("ping", std::chrono::seconds(20));
    // Close sockets which never authenticate. weak_ptr avoids retaining abandoned sockets.
    std::weak_ptr<WebSocketConnection> weak = conn;
    drogon::app().getLoop()->runAfter(10.0, [this, weak] {
        if (auto socket = weak.lock()) {
            std::lock_guard<std::mutex> lock(roomMutex_);
            if (members_.find(socket) == members_.end()) socket->shutdown();
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
            const auto identity = auth::verify(token, "tranquil-room");
            const auto expires = jwt::decode(token).get_expires_at();
            if (identity.role != "participant") throw std::invalid_argument("Invalid ticket");
            {
                std::lock_guard<std::mutex> lock(roomMutex_);
                if (!rooms_.join(identity.id, conn)) { reject(conn, "Room is full or unavailable"); return; }
                members_[conn] = {identity.id, expires};
                peers = rooms_.peers(identity.id, conn);
            }
            Json::Value joined; joined["type"] = "joined";
            joined["roomId"] = identity.id; joined["peers"] = static_cast<int>(peers.size());
            send(conn, joined);
            Json::Value ready; ready["type"] = "peer_joined";
            for (const auto& peer : peers) send(peer, ready);
            std::weak_ptr<WebSocketConnection> weak = conn;
            const auto seconds = std::chrono::duration<double>(expires - std::chrono::system_clock::now()).count();
            drogon::app().getLoop()->runAfter(seconds > 0 ? seconds : 0, [weak] {
                if (auto socket = weak.lock()) socket->shutdown();
            });
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
