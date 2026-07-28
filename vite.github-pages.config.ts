import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function githubPagesBase() {
  const repository = process.env.GITHUB_REPOSITORY?.split("/").pop();
  return repository ? `/${repository}/` : "/";
}

export default defineConfig({
  root: "github-pages",
  base: githubPagesBase(),
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: "../github-pages-dist",
    emptyOutDir: true,
  },
});
