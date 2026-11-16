FROM debian:bookworm-slim AS dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git ca-certificates pkg-config libssl-dev \
    zlib1g-dev libjsoncpp-dev uuid-dev && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch 1.28.0 https://github.com/mongodb/mongo-c-driver.git /tmp/mongo-c && \
    cmake -S /tmp/mongo-c -B /tmp/mongo-c-build -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr/local \
      -DENABLE_TESTS=OFF -DENABLE_EXAMPLES=OFF -DENABLE_SASL=OFF \
      -DENABLE_SNAPPY=OFF -DENABLE_ZSTD=OFF -DENABLE_SHM_COUNTERS=OFF && \
    cmake --build /tmp/mongo-c-build -j2 && cmake --install /tmp/mongo-c-build
RUN git clone --depth 1 --branch r3.11.0 https://github.com/mongodb/mongo-cxx-driver.git /tmp/mongo-cxx && \
    cmake -S /tmp/mongo-cxx -B /tmp/mongo-cxx-build -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr/local \
      -DCMAKE_CXX_STANDARD=17 -DBSONCXX_POLY_USE_STD=ON -DBUILD_VERSION=3.11.0 \
      -DENABLE_TESTS=OFF -DENABLE_EXAMPLES=OFF && \
    cmake --build /tmp/mongo-cxx-build -j2 && cmake --install /tmp/mongo-cxx-build
RUN git clone --depth 1 --branch v1.9.10 --recursive https://github.com/drogonframework/drogon.git /tmp/drogon && \
    cmake -S /tmp/drogon -B /tmp/drogon-build -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr/local \
      -DBUILD_SHARED_LIBS=ON -DBUILD_CTL=OFF -DBUILD_EXAMPLES=OFF -DBUILD_TESTING=OFF \
      -DBUILD_ORM=OFF -DBUILD_BROTLI=OFF -DBUILD_YAML_CONFIG=OFF && \
    cmake --build /tmp/drogon-build -j2 && cmake --install /tmp/drogon-build

FROM dependencies AS build
WORKDIR /src
COPY backend backend
COPY tests/core_test.cpp tests/core_test.cpp
RUN cmake -S backend -B out -DCMAKE_BUILD_TYPE=Release && \
    cmake --build out -j2 && \
    g++ -std=c++17 -Wall -Wextra -Werror tests/core_test.cpp -o /tmp/core_test && /tmp/core_test

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl3 zlib1g libjsoncpp25 libuuid1 && \
    rm -rf /var/lib/apt/lists/* && useradd --system --uid 10001 --create-home tranquil
COPY --from=build /usr/local/lib/ /usr/local/lib/
RUN ldconfig
WORKDIR /app
COPY --from=build /src/out/TranquilBackend /app/TranquilBackend
COPY web /app/web
ENV BIND_ADDRESS=0.0.0.0 PORT=8080 WEB_ROOT=/app/web
USER tranquil
EXPOSE 8080
CMD ["/app/TranquilBackend"]
