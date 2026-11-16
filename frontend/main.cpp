#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QtWebEngineQuick>
#include <QUrl>

int main(int argc, char* argv[]) {
    // Real devices and the normal permission UI are used unless the developer
    // explicitly supplies testing flags in their own environment.
    QtWebEngineQuick::initialize();
    QGuiApplication app(argc, argv);
    QQmlApplicationEngine engine;
    const auto url = qEnvironmentVariable("TRANQUIL_BASE_URL", "http://localhost:8080");
    const QUrl baseUrl(url);
    if (!baseUrl.isValid() ||
        (baseUrl.scheme() != "http" && baseUrl.scheme() != "https")) return 1;
    engine.rootContext()->setContextProperty("backendUrl", baseUrl);
    QObject::connect(&engine, &QQmlApplicationEngine::objectCreationFailed,
        &app, [] { QCoreApplication::exit(1); }, Qt::QueuedConnection);
    engine.load(QUrl(QStringLiteral("qrc:/TranquilTalk/LoginView.qml")));
    return app.exec();
}
