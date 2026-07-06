import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { marked } from "marked";
import { REPO_ROOT } from "../config.js";
import { HELP_SECTIONS } from "../helpSections.js";

export default function helpRoutes(app: FastifyInstance): void {
  app.get("/api/help", async () => ({
    sections: HELP_SECTIONS.map(({ slug, title, blurb, externalPath }) => ({
      slug,
      title,
      blurb,
      external: externalPath ?? null,
    })),
  }));

  app.get("/api/help/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const section = HELP_SECTIONS.find((s) => s.slug === slug);
    if (!section || !section.mdFile) return reply.code(404).send({ error: "unknown help section" });
    if (!existsSync(section.mdFile)) {
      return reply.code(404).send({ error: `guide file missing: ${section.mdFile}` });
    }
    // Rendered per request: guides are small and live-editable via the /repo mount.
    const html = await marked.parse(readFileSync(section.mdFile, "utf-8"));
    return { slug, title: section.title, html };
  });

  // The workflow map is a self-styled standalone page — served verbatim, new tab.
  app.get("/help/workflow", async (_req, reply) => {
    const file = join(REPO_ROOT, "docs/guides/workflow.html");
    if (!existsSync(file)) return reply.code(404).send("workflow.html not found");
    return reply.type("text/html; charset=utf-8").send(readFileSync(file, "utf-8"));
  });
}
