import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), cloudflare()],
  build: {
    // Cloudflare Pages 최적화
    outDir:          "dist",
    assetsDir:       "assets",
    sourcemap:       false,    // 프로덕션 소스맵 비활성화 (보안)
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        // 카카오맵 SDK는 외부 스크립트로 로드 → 번들 제외
        manualChunks: {
          vendor: ["react", "react-dom"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // 개발 환경에서 Workers API를 프록시
    proxy: {
      "/api": {
        target: "http://localhost:8787",  // wrangler dev 포트
        changeOrigin: true,
      },
      "/_kakao_sdk": {
        target: "https://dapi.kakao.com",
        changeOrigin: true,
        rewrite: () => "/v2/maps/sdk.js",
      },
    },
  },
});