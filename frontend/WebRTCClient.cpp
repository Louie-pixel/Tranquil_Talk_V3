#include "WebRTCClient.h"
#include <QDebug>

WebRTCClient::WebRTCClient(QObject *parent) : QObject(parent) {
    connect(&m_webSocket, &QWebSocket::connected, this, &WebRTCClient::onConnected);
    connect(&m_webSocket, &QWebSocket::textMessageReceived, this, &WebRTCClient::onTextMessageReceived);
}

void WebRTCClient::connectToRoom(const QString &roomId) {
    m_roomId = roomId;
    qDebug() << "Attempting to connect to room:" << m_roomId;
    m_webSocket.open(QUrl("ws://localhost:8080/rtc/signal"));
}

void WebRTCClient::onConnected() {
    qDebug() << "Connected to WebRTC Signaling Server!";
    emit connectedToRoom();
    
    // Instantly notify the backend that we are joining our specified room
    sendSignal("join");
}

void WebRTCClient::sendSignal(const QString &actionType, const QJsonObject &payload) {
    QJsonObject message = payload;
    message["type"] = actionType;
    message["roomId"] = m_roomId;

    QJsonDocument doc(message);
    m_webSocket.sendTextMessage(QString::fromUtf8(doc.toJson(QJsonDocument::Compact)));
}

void WebRTCClient::onTextMessageReceived(const QString &message) {
    QJsonDocument doc = QJsonDocument::fromJson(message.toUtf8());
    if (doc.isNull() || !doc.isObject()) return;

    QJsonObject obj = doc.object();
    QString type = obj["type"].toString();
    
    // Pass the incoming SDP offer/answer or ICE candidate up to QML
    emit incomingSignal(type, obj);
}
