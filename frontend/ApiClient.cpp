#include "ApiClient.h"
#include <QNetworkRequest>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>

ApiClient::ApiClient(QObject* parent) 
    : QObject(parent), m_networkManager(new QNetworkAccessManager(this)) {}

QString ApiClient::token() const { 
    return m_token; 
}

void ApiClient::login(const QString& email, const QString& password) {
    QUrl url(m_baseUrl + "/login");
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");

    QJsonObject json;
    json["email"] = email;
    json["password"] = password;
    QJsonDocument doc(json);

    QNetworkReply* reply = m_networkManager->post(request, doc.toJson());
    
    connect(reply, &QNetworkReply::finished, this, [this, reply]() { 
        onLoginFinished(reply); 
    });
}

void ApiClient::onLoginFinished(QNetworkReply* reply) {
    reply->deleteLater(); // Clean up memory

    if (reply->error() != QNetworkReply::NoError) {
        // HTTP error (e.g., 401 Unauthorized from our Drogon backend)
        emit loginFailed("Invalid credentials or server offline");
        return;
    }

    QJsonParseError parseError;
    QJsonDocument doc = QJsonDocument::fromJson(reply->readAll(), &parseError);
    
    if (parseError.error != QJsonParseError::NoError || !doc.isObject()) {
        emit loginFailed("Malformed response from server");
        return;
    }

    QJsonObject json = doc.object();
    if (json.contains("token")) {
        m_token = json["token"].toString();
        emit tokenChanged();
        emit loginSuccess();
    } else {
        emit loginFailed("No token provided by server");
    }
}