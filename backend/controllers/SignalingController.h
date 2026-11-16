#pragma once
#include <drogon/WebSocketController.h>
#include "../utils/RoomRegistry.h"
#include <mutex>
#include <chrono>
#include <unordered_map>

using namespace drogon;

class SignalingController : public drogon::WebSocketController<SignalingController> {
public:
    void handleNewMessage(const WebSocketConnectionPtr&, std::string&&,
                          const WebSocketMessageType&) override;
    void handleNewConnection(const HttpRequestPtr&, const WebSocketConnectionPtr&) override;
    void handleConnectionClosed(const WebSocketConnectionPtr&) override;
    WS_PATH_LIST_BEGIN
        WS_PATH_ADD("/rtc/signal");
    WS_PATH_LIST_END
private:
    struct Membership { std::string room; std::chrono::system_clock::time_point expires; };
    RoomRegistry<WebSocketConnectionPtr> rooms_;
    std::unordered_map<WebSocketConnectionPtr, Membership> members_;
    std::mutex roomMutex_;
};
