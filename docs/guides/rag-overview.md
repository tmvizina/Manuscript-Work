# RAG Overview — what the canon index is and why it saves tokens

**RAG** (retrieval-augmented generation) is a simple idea: instead of handing
an AI a whole filing cabinet and hoping it finds the right page, you build an
index ahead of time, and at question time you retrieve **only the few
paragraphs that matter** and hand it those.

## How it works here

1. **Chunk.** Every canon file — the `world/` memory (characters, threads,
   arcs, voice bible, continuity ledger) and every chapter — is split into
   pieces of roughly 1,200 characters. Markdown files split on their headings,
   so a chunk stays about one topic.
2. **Embed.** Each chunk is converted into an *embedding*: a list of numbers
   that captures what the chunk is about, computed by a small local model (no
   API, no cost, nothing leaves your machine). The chunks and their embeddings
   live in **ChromaDB**, the vector database in the docker stack.
3. **Retrieve.** A question ("who is the protagonist's father?") is embedded
   the same way, and ChromaDB returns the chunks whose embeddings sit nearest
   to it — the passages most *about* that question, even when they share no
   exact words with it.

## Why it matters

When a skill needs one canon fact, reading whole `world/` files might cost
tens of thousands of tokens; retrieving five relevant chunks costs a few
hundred. That's the entire trick — same answer, a fraction of the context.
The **RAG page** (top bar) shows the token cost next to every result, and its
query log shows which lookups came from skills.

Every skill in the sidebar has a **RAG-aware variant** (the Base / RAG-aware
toggle) that uses this index for canon lookups while still reading actual
manuscript text where the work requires it — a reviewer still reads the real
chapter it is reviewing; it just doesn't re-read all of `world/` to check one
name.

## What the index is NOT

- **Not the source of truth.** The `world/` files and chapter `.txt` files
  are. The index is a snapshot of them, taken at the last rebuild.
- **Not self-updating.** Edit canon or chapters and the index is stale until
  you rebuild it — see [Maintaining & Embedding the RAG](rag-maintenance.md).
- **Not exhaustive.** Retrieval returns the *most similar* chunks, not *all
  relevant* ones. The RAG-aware skills are told to fall back to reading the
  real file when retrieval comes back thin.
