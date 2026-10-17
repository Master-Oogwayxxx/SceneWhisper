# --- Stage 1: NVIDIA CUDA Runtime ---
# Using the 'devel' or 'runtime' image ensures CUDA libraries are present.
# Python 3.11 is then installed on top of this Ubuntu-based image.
FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04

# Set environment variables to keep things quiet during install
ENV DEBIAN_FRONTEND=noninteractive

# Install Python 3.11 and system dependencies
RUN apt-get update && apt-get install -y \
    python3.11 \
    python3-pip \
    ffmpeg \
    curl \
    gzip \
    tzdata \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Set the working directory inside the container
WORKDIR /app

# Copy requirements and install
# Note: We use python3.11 specifically to match your original environment
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    python3.11 -m pip install --no-cache-dir -r requirements.txt \
    && python3.11 -m pip install hf_transfer \
    && python3.11 -c "import argostranslate.package; argostranslate.package.update_package_index(); package = next(p for p in argostranslate.package.get_available_packages() if p.from_code == 'ja' and p.to_code == 'en'); argostranslate.package.install_from_path(package.download())"

# Pre-download the model files
# RUN python3.11 -c "from faster_whisper import WhisperModel; WhisperModel('large-v3')"

# Copy backend code
COPY . .

EXPOSE 8010

# Ensure we use python3.11 to run the app
CMD ["python3.11", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8010"]
