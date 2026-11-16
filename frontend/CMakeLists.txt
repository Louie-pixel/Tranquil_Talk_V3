cmake_minimum_required(VERSION 3.24)
project(TranquilFrontend LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
find_package(Qt6 6.4 REQUIRED COMPONENTS Core Gui Quick Qml WebEngineQuick)
qt_standard_project_setup(REQUIRES 6.4)
qt_add_executable(TranquilFrontend main.cpp)
qt_add_qml_module(TranquilFrontend URI TranquilTalk VERSION 1.0
    RESOURCE_PREFIX "/" QML_FILES Main.qml LoginView.qml RegistrationView.qml)
target_link_libraries(TranquilFrontend PRIVATE
    Qt6::Core Qt6::Gui Qt6::Quick Qt6::Qml Qt6::WebEngineQuick)
