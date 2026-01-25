FROM rust:latest as builder

WORKDIR /app

# Copy Cargo files
COPY Cargo.toml Cargo.lock ./

# Cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src

# Copy source
COPY src ./src

# Build
RUN touch src/main.rs && cargo build --release

# Runtime stage
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y ca-certificates containerd.io && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/aero-agent /usr/local/bin/aero-agent

EXPOSE 8080

CMD ["/usr/local/bin/aero-agent"]
