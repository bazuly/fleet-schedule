FROM rust:1-slim-bookworm AS builder
WORKDIR /app

# Отдельный слой с зависимостями, чтобы не пересобирать их при каждом изменении кода.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src

COPY migrations ./migrations
COPY src ./src
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/backend /usr/local/bin/backend
ENV PORT=8080
EXPOSE 8080
CMD ["backend"]
