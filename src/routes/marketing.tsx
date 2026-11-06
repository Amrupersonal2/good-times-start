import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, useRestaurantSettings } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { BrandEditor } from "@/components/marketing/BrandEditor";
import { QrKit } from "@/components/marketing/QrKit";
import { WhatsAppCenter } from "@/components/marketing/WhatsAppCenter";
import { MarketingResults } from "@/components/marketing/MarketingResults";
import { useStaff } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { useAccount } from "@/lib/use-account";
import { loadBrandingAndMarketing } from "@/lib/marketing-actions";
import { cn } from "@/lib/utils";

type Tab = "brand" | "qr" | "whatsapp" | "results";
const TABS: { v: Tab; l: string }[] = [
  { v: "brand", l: "Brand" },
  { v: "qr", l: "QR kit" },
  { v: "whatsapp", l: "WhatsApp" },
  { v: "results", l: "Results" },
];

export const Route = createFileRoute("/marketing")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => (TABS.some((t) => t.v === search["tab"]) && search["tab"] !== "brand" ? { tab: search["tab"] as Tab } : {}),
  head: () => ({ meta: [{ title: "Marketing — XTSY POS" }, { name: "description", content: "Your brand on the QR menu, printable QR codes and WhatsApp campaigns." }, { property: "og:title", content: "Marketing — XTSY POS" }, { property: "og:description", content: "Your brand on the QR menu, printable QR codes and WhatsApp campaigns." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },] }),
  component: MarketingPage,
});

function MarketingPage() {
  const { user } = useStaff();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab = search.tab ?? "brand";
  const settings = useRestaurantSettings();
  const account = useAccount();
  const restaurantId = user?.restaurantId ?? null;
  const data = useQuery({
    queryKey: ["branding", restaurantId],
    enabled: !!restaurantId && can(user, "marketing.manage"),
    queryFn: () => loadBrandingAndMarketing(restaurantId ?? ""),
    staleTime: 5 * 60_000,
  });

  if (!can(user, "marketing.manage")) {
    return <AppShell><p className="mx-auto max-w-md p-8 text-center text-sm text-muted-foreground">Marketing is for the owner and managers.</p></AppShell>;
  }
  const outlet = account.data?.outlet;
  const name = settings.name || outlet?.name || "";

  let body: ReactNode;
  if (!restaurantId) body = <p className="text-sm text-muted-foreground">Join a restaurant first.</p>;
  else if (data.isLoading || account.isLoading) body = <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-card" />)}</div>;
  else if (data.isError || !data.data) {
    body = (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <p className="font-semibold">Marketing needs the internet</p>
        <p className="mt-1 text-sm text-muted-foreground">{data.error instanceof Error ? data.error.message : "Check the connection and try again."}</p>
        <Button className="mt-4" onClick={() => void data.refetch()}>Try again</Button>
      </div>
    );
  } else if (tab === "brand") body = <BrandEditor restaurantId={restaurantId} restaurantName={name} saved={data.data.branding} />;
  else if (tab === "qr") body = outlet?.slug ? <QrKit slug={outlet.slug} restaurantName={name} brand={data.data.branding} ordering={outlet.ordering ?? {}} />
    : <p className="text-sm text-muted-foreground">Set your ordering web address in Settings → Guest ordering first.</p>;
  else if (tab === "whatsapp") body = <WhatsAppCenter restaurantId={restaurantId} restaurantName={name} slug={outlet?.slug ?? null} brand={data.data.branding} settings={data.data.marketing} />;
  else body = <MarketingResults restaurantId={restaurantId} />;

  return (
    <AppShell>
      <div className="min-h-full">
        <div className="sticky top-[57px] z-10 border-b border-border bg-card/90 px-4 backdrop-blur-xl lg:px-8">
          <nav className="flex gap-6 overflow-x-auto" aria-label="Marketing">
            {TABS.map(({ v, l }) => (
              <button key={v} type="button" aria-current={tab === v ? "page" : undefined} onClick={() => void navigate({ search: v === "brand" ? {} : { tab: v }, replace: true })}
                className={cn("-mb-px shrink-0 border-b-2 py-3 text-sm font-semibold transition-colors", tab === v ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{l}</button>
            ))}
          </nav>
        </div>
        <div className="mx-auto max-w-6xl p-4 lg:p-8">{body}</div>
      </div>
    </AppShell>
  );
}
