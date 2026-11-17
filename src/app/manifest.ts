import type { MetadataRoute } from "next";

/** Makes the app installable on phones (add to home screen). Offline support arrives in Phase 3. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "حضانة يانمو — Yanmu Nursery",
    short_name: "Yanmu",
    description: "Nursery Command Center",
    start_url: "/",
    display: "standalone",
    background_color: "#F6F5F2",
    theme_color: "#1F3A5F",
    lang: "ar",
    dir: "auto",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
