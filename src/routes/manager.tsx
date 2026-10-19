import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { setAppMode } from "@/lib/app-mode";
import { useStaff } from "@/lib/auth-context";
import logo from "@/assets/logo.png";

/** Where POS Business Manager opens: marks this window as Business Manager, then goes to the dashboard. */
export const Route = createFileRoute("/manager")({
  head: () => ({ meta: [{ title: "POS Business Manager — XTSY" }, { name: "description", content: "Sales, reports, menu, stock, marketing and settings for TAB Bistro." }] }),
  component: ManagerStart,
});

function ManagerStart() {
  const { user, loading } = useStaff();
  const navigate = useNavigate();
  useEffect(() => {
    setAppMode("manager");
    if (loading) return;
    void navigate({ to: user ? "/dashboard" : "/auth", replace: true });
  }, [user, loading, navigate]);
  return <div className="grid min-h-screen place-items-center bg-background"><img src={logo} alt="POS Business Manager" width={44} height={44} className="rounded-xl opacity-80" /></div>;
}
