import type { FastifyInstance } from "fastify";
import { refreshChapter, syncChapters } from "../chapterSync.js";
import type { DB } from "../db/db.js";

const LIST_COLS = "chapter_id, book, rel_path, number, title, word_count, file_mtime, synced_at";

export default function chapterRoutes(app: FastifyInstance, db: DB): void {
  app.get("/api/chapters", async (req) => {
    const { book } = req.query as { book?: string };
    const rows = book
      ? db.prepare(`SELECT ${LIST_COLS} FROM chapters WHERE active = 1 AND book = ? ORDER BY book, number, chapter_id`).all(book)
      : db.prepare(`SELECT ${LIST_COLS} FROM chapters WHERE active = 1 ORDER BY book, number, chapter_id`).all();
    return { chapters: rows };
  });

  app.get("/api/chapters/:id", async (req, reply) => {
    const id = decodeURIComponent((req.params as { id: string }).id);
    if ((req.query as { fresh?: string }).fresh === "1") refreshChapter(db, id);
    const row = db.prepare("SELECT * FROM chapters WHERE chapter_id = ?").get(id);
    if (!row) return reply.code(404).send({ error: "unknown chapter" });
    return row;
  });

  app.post("/api/chapters/sync", async () => syncChapters(db));
}
