FROM python:3.12-slim

# Install Node.js 20.x for the execution service sidecar
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Install execution service Node.js dependencies
COPY execution_service/package.json execution_service/package-lock.json* execution_service/
RUN cd execution_service && npm install --production

COPY . .
RUN uv sync --frozen --no-dev

ENV PORT=8000
EXPOSE 8000

# Start execution service in background, then Python server in foreground
CMD ["sh", "-c", "cd execution_service && node server.js & cd /app && exec uv run uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
