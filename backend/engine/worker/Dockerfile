FROM python:3.12-slim AS base

WORKDIR /app

# Install Python dependencies
COPY infra/engine-requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the full backend package
COPY backend/ backend/

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

CMD ["python", "-m", "backend.engine.worker.main"]
