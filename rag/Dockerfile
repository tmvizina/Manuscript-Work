FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Bake the ONNX MiniLM embedding model into the image so the first in-container
# ingest doesn't stall on an ~80MB download.
RUN python -c "from chromadb.utils.embedding_functions import DefaultEmbeddingFunction; DefaultEmbeddingFunction()(['warmup'])"

COPY raglib.py ingest.py query.py rag_worker.py serve.py ./

# No chroma_db/ baked in: the index lives either in the chromadb service
# (CHROMA_HOST set, the compose setup) or a mounted volume. Rebuild via
# POST /ingest or `python ingest.py --rebuild`.

EXPOSE 8801
CMD ["python", "serve.py"]
