import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/Studio";

export const Route = createFileRoute("/studio")({
  head: () => ({
    meta: [
      { title: "Profile Hub Studio — je eigen link-in-bio | ROUT" },
      {
        name: "description",
        content:
          "Bouw je soevereine link-in-bio: blokken, ontwerp, subdomein en verificatie. Bewerk in concept en publiceer wanneer je klaar bent.",
      },
      { property: "og:title", content: "Profile Hub Studio — je eigen link-in-bio | ROUT" },
      {
        property: "og:description",
        content:
          "Bouw je soevereine link-in-bio: blokken, ontwerp, subdomein en verificatie. Bewerk in concept en publiceer wanneer je klaar bent.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});
