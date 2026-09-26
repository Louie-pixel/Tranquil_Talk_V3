cmake_minimum_required(VERSION 3.16)
project(TranquilBackend CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Drogon REQUIRED)
find_package(mongocxx REQUIRED)
find_package(bsoncxx REQUIRED)

add_executable(TranquilBackend
    main.cc
    controllers/ClinicController.cc
    controllers/UserController.cc
    controllers/SignalingController.cc
    models/DatabaseManager.cc
)

target_link_libraries(TranquilBackend PRIVATE
    Drogon::Drogon
    mongo::mongocxx_shared
    mongo::bsoncxx_shared
    bcrypt
)
