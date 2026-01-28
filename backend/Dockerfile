FROM python:3.11-slim-bookworm

WORKDIR /app

# Install system dependencies
# Note: libaio1 renamed to libaio1t64 in newer Debian, using libaio-dev for compatibility
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libaio-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY src/ ./src/

# Set Python path
ENV PYTHONPATH=/app

# Expose port
EXPOSE 5000

# Run the application
CMD ["python", "-m", "src.api.app"]
