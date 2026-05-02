FROM python:3.12-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY . .
RUN uv sync --frozen --no-dev

ENV PORT=8000
EXPOSE 8000

# Execution service runs as a separate Railway deployment from apps/execution.
# Backend reaches it via EXECUTION_SERVICE_URL (typically the Railway internal
# DNS name, e.g. http://execution-service.railway.internal:8080).
CMD ["sh", "-c", "exec uv run uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --no-access-log"]
