#pragma once
#include <QObject>
#include <QtWebSockets/QWebSocket>
#include <QJsonObject>
#include <QJsonDocument>

class WebRTCClient : public QObject {
    Q_OBJECT

public:
    explicit WebRTCClient(QObject *parent = nullptr);

    // Callable from QML
    Q_INVOKABLE void connectToRoom(const QString &roomId);
    Q_INVOKABLE void sendSignal(const QString &actionType, const QJsonObject &payload = QJsonObject());

signals:
    // Emitted to QML when the backend sends us a WebRTC offer/answer
    void incomingSignal(const QString &actionType, const QJsonObject &payload);
    void connectedToRoom();

private slots:
    void onConnected();
    void onTextMessageReceived(const QString &message);

private:
    QWebSocket m_webSocket;
    QString m_roomId;
};
