FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-dev python3-venv python3-pip \
    build-essential gfortran pkg-config libopenblas-dev cmake ninja-build \
    llvm-15-dev libjpeg-dev zlib1g-dev libfreetype6-dev libpng-dev libtiff-dev libwebp-dev \
    libffi-dev libssl-dev libpq-dev curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# current Rust (distro rustc is too old for orjson / tiktoken)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal

RUN python3 -m venv /opt/venv
ENV PATH="/root/.cargo/bin:/opt/venv/bin:$PATH"
ENV LLVM_CONFIG=/usr/bin/llvm-config-15

COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install --upgrade pip && \
    pip install "setuptools<70" wheel numpy && \
    pip install --no-build-isolation llvmlite==0.44.0
RUN --mount=type=cache,target=/root/.cache/pip pip install --timeout 120 --retries 10 -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
