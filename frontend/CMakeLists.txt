cmake_minimum_required(VERSION 3.16)
project(TranquilFrontend CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 1. WebEngineQuick and WebSockets MUST be listed here so CMake knows to find their headers
find_package(Qt6 REQUIRED COMPONENTS Core Gui Quick Positioning Qml WebSockets WebEngineQuick)

qt_standard_project_setup()

qt_add_executable(TranquilFrontend
    main.cpp
    ApiClient.cpp
    ApiClient.h
    WebRTCClient.cpp
)

qt_add_qml_module(TranquilFrontend
    URI TranquilTalk
    VERSION 1.0
    QML_FILES
        LoginView.qml
        ClinicMapView.qml
        VideoCallView.qml
)

# 2. They MUST also be linked here so the final executable can use them
target_link_libraries(TranquilFrontend PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Quick
    Qt6::Positioning
    Qt6::Qml
    Qt6::WebSockets
    Qt6::WebEngineQuick
)