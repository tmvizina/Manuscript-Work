FROM python:3.11-slim

WORKDIR /app
RUN pip install --no-cache-dir chromadb

COPY raglib.py query.py serve.py ./
COPY chroma_db ./chroma_db

# Download the ONNX embedding model into the image and validate the baked DB.
RUN python -c "import raglib; c = raglib.get_collection(); c.query(query_texts=['warmup'], n_results=1); print('warm:', c.count(), 'chunks')"

EXPOSE 8801
CMD ["python", "serve.py"]
