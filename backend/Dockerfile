# Stage 1: Go builder
FROM golang:1.27-alpine AS builder
WORKDIR /app
RUN apk add --no-cache git make
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /backend ./cmd/backend

# Stage 2: Minimal runtime
FROM alpine:3.20
WORKDIR /app

# System deps: ca-certificates for HTTPS, tzdata for timezone
RUN apk add --no-cache ca-certificates tzdata

# Copy Go binary
COPY --from=builder /backend /usr/local/bin/backend

# Copy migrations (run programmatically by Go app)
COPY backend/migrations/ /app/migrations/

# Copy .env for viper config loading (searched at /app/.env)
COPY .env /app/.env

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:8080/health || exit 1

ENTRYPOINT ["backend"]