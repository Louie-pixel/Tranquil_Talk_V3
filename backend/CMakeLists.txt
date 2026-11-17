cmake_minimum_required(VERSION 3.24)
project(TranquilBackend LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Drogon CONFIG REQUIRED)
find_package(mongocxx CONFIG REQUIRED)
find_package(bsoncxx CONFIG REQUIRED)
find_package(OpenSSL REQUIRED)
find_package(ICU 72 REQUIRED COMPONENTS uc i18n)
include(FetchContent)
set(JWT_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(JWT_BUILD_TESTS OFF CACHE BOOL "" FORCE)
FetchContent_Declare(jwt_cpp
    GIT_REPOSITORY https://github.com/Thalhammer/jwt-cpp.git
    GIT_TAG e71e0c2d584baff06925bbb3aad683f677e4d498)
FetchContent_MakeAvailable(jwt_cpp)
# Legacy gitlinks had no .gitmodules file; use pinned, reproducible dependencies instead.
FetchContent_Declare(bcrypt_source
    GIT_REPOSITORY https://github.com/trusch/libbcrypt.git
    GIT_TAG d6523c370de6e724ce4ec703e2449b5b028ea3b1
    SOURCE_SUBDIR unused)
FetchContent_MakeAvailable(bcrypt_source)
add_library(tranquil_bcrypt STATIC
    ${bcrypt_source_SOURCE_DIR}/src/bcrypt.c
    ${bcrypt_source_SOURCE_DIR}/src/crypt_blowfish.c
    ${bcrypt_source_SOURCE_DIR}/src/crypt_gensalt.c
    ${bcrypt_source_SOURCE_DIR}/src/wrapper.c)
target_include_directories(tranquil_bcrypt PUBLIC ${bcrypt_source_SOURCE_DIR}/include
    PRIVATE ${bcrypt_source_SOURCE_DIR}/include/bcrypt ${bcrypt_source_SOURCE_DIR}/src)

add_executable(TranquilBackend main.cc
    controllers/ClinicController.cc controllers/UserController.cc
    controllers/SignalingController.cc controllers/SessionController.cc controllers/ContentController.cc controllers/ExpertController.cc
    controllers/WorkflowController.cc controllers/WorkflowAccounts.cc controllers/ManagementController.cc
    controllers/PreferencesController.cc controllers/ClinicIntegrationController.cc models/DatabaseManager.cc)
target_link_libraries(TranquilBackend PRIVATE Drogon::Drogon
    mongo::mongocxx_shared mongo::bsoncxx_shared jwt-cpp::jwt-cpp tranquil_bcrypt OpenSSL::Crypto ICU::uc ICU::i18n)
target_compile_options(TranquilBackend PRIVATE -Wall -Wextra -Wpedantic)

