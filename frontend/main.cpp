
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QUrl>
#include "WebRTCClient.h"

#ifdef HAS_WEBENGINE
#include <QtWebEngineQuick>// Add this import
#endif

int main(int argc, char *argv[]) {
    // Inject Chromium flags to bypass WSL2 webcam limitations for testing
    // Update this line at the top of your main() function:
qputenv("QTWEBENGINE_CHROMIUM_FLAGS", "--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --disable-gpu --disable-gpu-compositing");
    // Must be called BEFORE QGuiApplication
    
    #ifdef HAS_WEBENGINE
    qputenv("QTWEBENGINE_CHROMIUM_FLAGS", "--use-fake-ui-for-media-stream ...");
    QtWebEngineQuick::initialize();
    #endif
    
    QGuiApplication app(argc, argv);
    
    qmlRegisterType<WebRTCClient>("TranquilTalk.WebRTC", 1, 0, "WebRTCClient");

    QQmlApplicationEngine engine;
    
    QObject::connect(&engine, &QQmlApplicationEngine::objectCreationFailed,
        &app, []() { QCoreApplication::exit(-1); },
        Qt::QueuedConnection);
        
    engine.load(QUrl(QStringLiteral("qrc:/TranquilTalk/LoginView.qml")));

    return app.exec();
}