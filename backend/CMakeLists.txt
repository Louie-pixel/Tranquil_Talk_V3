cmake_minimum_required(VERSION 3.15)
project(TranquilBackend CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

list(APPEND CMAKE_PREFIX_PATH "/home/louie/mongo-cxx-driver/build/install")

find_package(Drogon REQUIRED)
find_package(bsoncxx REQUIRED)
find_package(mongocxx REQUIRED)

include_directories(third_party/jwt-cpp/include)
# Fix 1: Point to the bcrypt include directory
include_directories(third_party/bcrypt/include)

# Fix 2: Recursively grab all the source files inside the bcrypt src directory
file(GLOB_RECURSE BCRYPT_SOURCES "third_party/bcrypt/src/*.cpp" "third_party/bcrypt/src/*.c")

add_executable(${PROJECT_NAME} 
    main.cc
    models/DatabaseManager.cc
    controllers/UserController.cc
    ${BCRYPT_SOURCES}
)

target_link_libraries(${PROJECT_NAME} PRIVATE 
    Drogon::Drogon
    mongo::mongocxx_shared
    mongo::bsoncxx_shared
)
