import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// PWA pensée mobile d'abord (voir docs/ARCHITECTURE.md §7). Les données
// financières ne sont jamais mises en cache offline au-delà de la session
// courante : seul le cache des assets statiques est géré par le service
// worker (network-first pour les appels API/Edge Functions).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon.svg"],
      manifest: {
        name: "Frais Scolaires",
        short_name: "FraisScolaires",
        description: "Gestion des frais de scolarité pour écoles privées",
        theme_color: "#0f172a",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/functions\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/rest/") || url.pathname.startsWith("/functions/"),
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
