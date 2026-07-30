import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  server: {
    port: 5173,
    host: true,
    // Optional: same-origin /ws during `npm run dev` (set localStorage or use VITE_WS_URL otherwise)
    proxy: {
      "/ws": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        ws: true,
        rewrite: (p) => p.replace(/^\/ws/, "") || "/",
      },
    },
  },
});
