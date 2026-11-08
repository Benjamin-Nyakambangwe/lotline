import type { MetadataRoute } from "next";

/** Installable app (needed for alerts on iPhone: add Lotline to the Home Screen first). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lotline",
    short_name: "Lotline",
    description:
      "Know your line on every lot: live bids, budgets and alerts for ABC Auctions.",
    id: "/",
    start_url: "/watchlist",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f1218",
    theme_color: "#0f1218",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
