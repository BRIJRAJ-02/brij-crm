# Centrifugo, one node on the memory engine. Build from the repo root:
#   docker build -f infra/centrifugo/Dockerfile .
# Port 8000 is public (client connections only). Port 9000 is internal: the HTTP
# API the relay publishes to, the admin UI and /health. Secrets come from the
# environment (CENTRIFUGO_HTTP_API_KEY, CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY,
# CENTRIFUGO_ADMIN_PASSWORD, CENTRIFUGO_ADMIN_SECRET, CENTRIFUGO_CLIENT_ALLOWED_ORIGINS).
FROM centrifugo/centrifugo:v6.9.7
COPY infra/centrifugo/config.json /centrifugo/config.json
CMD ["centrifugo", "--config", "/centrifugo/config.json"]
