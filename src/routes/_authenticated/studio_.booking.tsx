import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/BookingStudio";

export const Route = createFileRoute("/_authenticated/studio_/booking")({
  head: () => ({
    meta: [
      { title: "Boekingen | ROUT Studio" },
      { name: "description", content: "Beheer boekingssoorten, beschikbaarheid, agenda's en afspraken." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Boekingen | ROUT Studio" },
      { property: "og:description", content: "Beheer boekingssoorten, beschikbaarheid, agenda's en afspraken." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});
