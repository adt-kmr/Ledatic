import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@components": path.resolve(__dirname, "src/components"),
      "@admin": path.resolve(__dirname, "src/admin"),
      "@lib": path.resolve(__dirname, "src/lib"),
      "@hooks": path.resolve(__dirname, "src/hooks"),
      "@stores": path.resolve(__dirname, "src/stores"),
      "@types": path.resolve(__dirname, "src/types"),
      "@data": path.resolve(__dirname, "src/data"),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        // Host-machine dev: backend runs on localhost:8000. Inside a container
        // set VITE_PROXY_TARGET=http://backend:8000 (the compose service name).
        target: process.env.VITE_PROXY_TARGET || "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
