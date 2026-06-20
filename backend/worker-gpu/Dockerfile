FROM nvidia/cuda:12.3.1-devel-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Compilar el miner CUDA
COPY cuda/ ./cuda/
RUN nvcc cuda/hit7_range_miner.cu -o range_miner -O2

# Instalar dependencias Python
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY main.py miner.py ./

CMD ["python3", "main.py"]
