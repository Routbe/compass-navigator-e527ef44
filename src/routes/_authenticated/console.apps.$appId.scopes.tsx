import { createFileRoute } from "@tanstack/react-router";
import { ConsoleCard, ConsolePage } from "@/components/console/ConsolePage";
import { useAppPage } from "@/components/console/useAppPage";
import { HandleSyncCard } from "@/components/console/HandleSyncCard";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/console/apps/$appId/scopes")({
  component: ScopesPage,
});

const SCOPES = [
  { id: "openid", label: "openid", text: "Verplicht. Geeft een vaste, anonieme gebruikers-ID (sub).", locked: true },
  { id: "profile", label: "profile", text: "Naam, @handle en profielfoto.", locked: false },
  { id: "email", label: "email", text: "E-mailadres en of het bevestigd is.", locked: false },
  {
    id: "linked_accounts",
    label: "linked_accounts",
    text: "Welke sign-ins (Google, Apple, GitHub…) aan het ROUT-account hangen. Gebruik dit om bestaande accounts te herkennen en te koppelen i.p.v. dubbel aan te maken.",
    locked: false,
  },
];

function ScopesPage() {
  const { appId } = Route.useParams();
  const { app, persist, saving } = useAppPage(appId);
  const origin = typeof window === "undefined" ? "https://rout.be" : window.location.origin;
  const snippet = `${origin}/oauth/authorize?response_type=code
  &client_id=${app.clientId}
  &redirect_uri=${encodeURIComponent(app.redirectUris[0] ?? "")}
  &scope=${app.scopes.join("%20")}
  &state=RANDOM&nonce=RANDOM
  &code_challenge=BASE64URL(SHA256(verifier))
  &code_challenge_method=S256`;

  return (
    <ConsolePage title="Scopes" description="Vraag enkel wat je app echt nodig heeft.">
      <ConsoleCard>
        <ul className="divide-y divide-border">
          {SCOPES.map((s) => (
            <li key={s.id} className="flex items-center gap-4 py-3">
              <div className="flex-1">
                <code className="text-sm">{s.label}</code>
                <p className="text-xs text-muted-foreground">{s.text}</p>
              </div>
              <Switch
                checked={app.scopes.includes(s.id)}
                disabled={s.locked || saving}
                onCheckedChange={(on) =>
                  persist({ scopes: on ? [...app.scopes, s.id] : app.scopes.filter((x) => x !== s.id) })
                }
              />
            </li>
          ))}
        </ul>
      </ConsoleCard>
      <HandleSyncCard app={app} saving={saving} persist={persist} />
      <ConsoleCard title="Autorisatie-URL (PKCE)" description="PKCE met S256 is verplicht.">
        <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs">{snippet}</pre>
      </ConsoleCard>
    </ConsolePage>
  );
}
