cmake_minimum_required(VERSION 3.16)
project(TranquilFrontend CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Qt6 REQUIRED COMPONENTS Core Gui Quick Positioning)

qt_standard_project_setup()

qt_add_executable(TranquilFrontend
    main.cpp
    ApiClient.cpp
    ApiClient.h
)

qt_add_qml_module(TranquilFrontend
    URI TranquilTalk
    VERSION 1.0
    QML_FILES
        LoginView.qml
        ClinicMapView.qml
)

target_link_libraries(TranquilFrontend PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Quick
    Qt6::Positioning
)
