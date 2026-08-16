import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** Return true when candidate is root itself or a descendant of root. */
export function isPathInside(root: string, candidate: string, allowRoot = true): boolean {
  const rootAbs = resolve(root);
  const candidateAbs = resolve(candidate);
  const rel = relative(rootAbs, candidateAbs);
  if (rel === "") return allowRoot;
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Resolve a path supplied by a caller without allowing traversal outside root. */
export function resolveInside(root: string, requested: string, allowRoot = false): string | null {
  if (typeof requested !== "string") return null;
  const candidate = resolve(root, requested);
  return isPathInside(root, candidate, allowRoot) ? candidate : null;
}

export function toPosixRelative(root: string, fullPath: string): string {
  return relative(resolve(root), resolve(fullPath)).split(sep).join("/");
}

/** Safe resolver for files below a project's world/ directory. */
export function safeWorldPath(projectRoot: string, relPath: string): string | null {
  return resolveInside(join(resolve(projectRoot), "world"), relPath, false);
}

const REVIEW_ROOTS = ["reviews", "editing-plan"] as const;

/** Safe resolver for files below reviews/ or editing-plan/. */
export function safeReviewPath(projectRoot: string, relPath: string): string | null {
  if (typeof relPath !== "string") return null;
  const normalized = relPath.replace(/\\/g, "/");
  const rootName = REVIEW_ROOTS.find((root) => normalized.startsWith(`${root}/`));
  if (!rootName) return null;
  const root = join(resolve(projectRoot), rootName);
  const child = normalized.slice(rootName.length + 1);
  if (!child) return null;
  return resolveInside(root, child, false);
}

/** Safe resolver for repository-owned help/guide files. */
export function safeRepoPath(repoRoot: string, relPath: string): string | null {
  return resolveInside(resolve(repoRoot), relPath, false);
}
