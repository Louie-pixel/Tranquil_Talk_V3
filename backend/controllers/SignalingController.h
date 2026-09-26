#pragma once
#include <drogon/WebSocketController.h>
#include <unordered_map>
#include <mutex>
#include <memory>

using namespace drogon;

class SignalingController : public drogon::WebSocketController<SignalingController>
{
  public:
    virtual void handleNewMessage(const WebSocketConnectionPtr&,
                                  std::string &&,
                                  const WebSocketMessageType &) override;
    virtual void handleNewConnection(const HttpRequestPtr &,
                                     const WebSocketConnectionPtr&) override;
    virtual void handleConnectionClosed(const WebSocketConnectionPtr&) override;

    WS_PATH_LIST_BEGIN
    WS_PATH_ADD("/rtc/signal"); 
    WS_PATH_LIST_END

  private:
    // Thread-safe map to store connections by room ID
    std::unordered_map<std::string, std::vector<WebSocketConnectionPtr>> rooms_;
    std::mutex roomMutex_;
};
