cmake_minimum_required(VERSION 3.16)
project(TranquilFrontend VERSION 0.1 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find the Qt 6 libraries
find_package(Qt6 REQUIRED COMPONENTS Core Gui Qml Quick Network)

qt_standard_project_setup()

# Add the C++ files
qt_add_executable(TranquilFrontend
    main.cpp
    ApiClient.cpp ApiClient.h
)

# Add the QML files
qt_add_qml_module(TranquilFrontend
    URI TranquilTalk
    VERSION 1.0
    QML_FILES LoginView.qml
)

# Link the libraries
target_link_libraries(TranquilFrontend
    PRIVATE Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick Qt6::Network
)
