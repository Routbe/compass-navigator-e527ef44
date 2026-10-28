import { createFileRoute } from "@tanstack/react-router";
import BookingDone from "@/pages/BookingDone";

export const Route = createFileRoute("/booking/$bookingId")({
  validateSearch: (s: Record<string, unknown>) => ({ paid: s["paid"] === "1" || s["paid"] === 1 ? "1" : undefined }),
  head: () => ({
    meta: [
      { title: "Je afspraak | ROUT" },
      { name: "description", content: "Bevestiging van je afspraak via ROUT." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Je afspraak | ROUT" },
      { property: "og:description", content: "Bevestiging van je afspraak via ROUT." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DoneRoute,
});

function DoneRoute() {
  const { bookingId } = Route.useParams();
  const { paid } = Route.useSearch();
  return <BookingDone bookingId={bookingId} paid={paid === "1"} />;
}
