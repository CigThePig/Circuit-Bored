import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        game: "index.html",
        visualLab: "visual-lab.html",
      },
    },
  },
});
