import { createFileRoute } from "@tanstack/react-router";
import BookPublic from "@/pages/BookPublic";

export const Route = createFileRoute("/book/$eventTypeId")({
  head: () => ({
    meta: [
      { title: "Plan een afspraak | ROUT" },
      { name: "description", content: "Kies een vrij moment en boek direct een afspraak via ROUT." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Plan een afspraak | ROUT" },
      { property: "og:description", content: "Kies een vrij moment en boek direct een afspraak via ROUT." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BookRoute,
});

function BookRoute() {
  const { eventTypeId } = Route.useParams();
  return <BookPublic eventTypeId={eventTypeId} />;
}
