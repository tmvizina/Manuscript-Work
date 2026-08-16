import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "app/**/src/**/*.{test,spec}.{ts,tsx}",
      "packages/**/src/**/*.{test,spec}.{ts,tsx}",
      "test/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx}",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
    passWithNoTests: true,
  },
});
