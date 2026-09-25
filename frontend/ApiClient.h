#pragma once
#include <QObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QString>

class ApiClient : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString token READ token NOTIFY tokenChanged)

public:
    explicit ApiClient(QObject* parent = nullptr);
    QString token() const;

public slots:
    // Exposed to QML to trigger the POST request
    void login(const QString& email, const QString& password);

signals:
    // Signals picked up by QML to update the UI
    void loginSuccess();
    void loginFailed(const QString& error);
    void tokenChanged();

private slots:
    void onLoginFinished(QNetworkReply* reply);

private:
    QNetworkAccessManager* m_networkManager;
    QString m_token;
    
    // WebAssembly builds will need relative paths or the production URL later
    const QString m_baseUrl = "http://localhost:8080/api"; 
};