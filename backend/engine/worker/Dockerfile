FROM python:3.12-slim AS base

WORKDIR /app

# Install Python dependencies
COPY backend/requirements-engine.txt requirements-engine.txt
COPY backend/requirements-shared.txt requirements-shared.txt
RUN pip install --no-cache-dir -r requirements-engine.txt -r requirements-shared.txt

# Copy the full backend package
COPY backend/ backend/

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

CMD ["python", "-m", "backend.engine.worker.main"]
