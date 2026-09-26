#include "SignalingController.h"
#include <json/json.h>
#include <iostream>
#include <algorithm>

void SignalingController::handleNewConnection(const HttpRequestPtr &req, const WebSocketConnectionPtr& conn)
{
    std::cout << "New WebRTC signaling connection established." << std::endl;
}

void SignalingController::handleConnectionClosed(const WebSocketConnectionPtr& conn)
{
    std::lock_guard<std::mutex> lock(roomMutex_);
    
    // Safely remove the disconnected client from any room they were in
    for (auto& room : rooms_) {
        auto& clients = room.second;
        clients.erase(std::remove(clients.begin(), clients.end(), conn), clients.end());
    }
    std::cout << "Client disconnected, cleaned up room data." << std::endl;
}

void SignalingController::handleNewMessage(const WebSocketConnectionPtr& conn,
                                           std::string &&message,
                                           const WebSocketMessageType &type)
{
    // We only process string-based JSON payloads
    if (type != WebSocketMessageType::Text) return;

    Json::CharReaderBuilder builder;
    Json::Value json;
    std::string errs;
    std::unique_ptr<Json::CharReader> reader(builder.newCharReader());

    if (!reader->parse(message.data(), message.data() + message.length(), &json, &errs)) {
        std::cerr << "WebSocket JSON Parse Error: " << errs << std::endl;
        return;
    }

    std::string actionType = json["type"].asString();
    std::string roomId = json["roomId"].asString();

    if (roomId.empty()) return;

    std::lock_guard<std::mutex> lock(roomMutex_);

    if (actionType == "join") {
        // Register the client to the specific room ID
        rooms_[roomId].push_back(conn);
        std::cout << "Client joined room: " << roomId << std::endl;
    } 
    else if (actionType == "offer" || actionType == "answer" || actionType == "ice_candidate") {
        // Broadcast the WebRTC payload to the OTHER client in the same room
        if (rooms_.find(roomId) != rooms_.end()) {
            for (auto& client : rooms_[roomId]) {
                if (client != conn) {
                    client->send(message); 
                }
            }
        }
    }
}
