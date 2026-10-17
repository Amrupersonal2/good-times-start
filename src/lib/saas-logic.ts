/** Plans, accounts and outlets: the SaaS side of XTSY POS. Pure functions only. */

export type PlanFeature = "qr_ordering" | "online_ordering" | "multi_outlet" | "insights";
export type AccountStatus = "trialing" | "active" | "past_due" | "suspended" | "cancelled";

export interface Plan {
  id: string;
  name: string;
  monthly_price: number;
  yearly_price: number;
  max_outlets: number;
  max_staff: number;
  features: Partial<Record<PlanFeature, boolean>>;
  sort: number;
  active: boolean;
}

export interface Account {
  id: string;
  name: string;
  plan_id: string;
  status: AccountStatus;
  trial_ends_at: string | null;
  paid_until: string | null;
  billing_email: string;
  billing_phone: string;
  billing_gstin: string;
}

/** Guest ordering switches stored on each outlet. */
export interface OrderingConfig {
  /** QR codes on tables: guests order to their table. */
  table?: boolean;
  /** Online ordering for pickup from the outlet's link. */
  online?: boolean;
  /** Stop taking guest orders for a while (kitchen rush, closing time). */
  paused?: boolean;
  /** Show the outlet's UPI ID so guests can pay from their phone. */
  upi?: boolean;
  /** Minutes until a pickup order is usually ready. */
  prepMinutes?: number;
  /** Smallest pickup order, in rupees. */
  minOrder?: number;
  /** A line shown at the top of the ordering page. */
  message?: string;
}

export const FEATURE_LABELS: Record<PlanFeature, string> = {
  qr_ordering: "QR ordering at tables",
  online_ordering: "Online ordering for pickup",
  multi_outlet: "Several outlets in one account",
  insights: "Owner insights app",
};

export const STATUS_LABELS: Record<AccountStatus, string> = {
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment due",
  suspended: "Suspended",
  cancelled: "Cancelled",
};

const DAY = 24 * 60 * 60 * 1000;
/** Days after the paid period ends before the account stops (matches the database). */
export const GRACE_DAYS = 7;

export interface AccountState {
  live: boolean;
  /** Short line for banners and the plan card. */
  label: string;
  /** Whether owners should be nudged now. */
  warn: boolean;
  daysLeft: number | null;
}

/** Mirror of the database's account_is_live, with wording for the owner. */
export function accountState(account: Pick<Account, "status" | "trial_ends_at" | "paid_until"> | null | undefined, now = Date.now()): AccountState {
  if (!account) return { live: true, label: "", warn: false, daysLeft: null };
  const days = (iso: string | null) => (iso ? Math.ceil((Date.parse(iso) - now) / DAY) : null);
  switch (account.status) {
    case "trialing": {
      const left = days(account.trial_ends_at);
      if (left === null) return { live: true, label: "Free trial", warn: false, daysLeft: null };
      if (left <= 0) return { live: false, label: "Your free trial has ended", warn: true, daysLeft: 0 };
      return { live: true, label: `Free trial: ${left} day${left === 1 ? "" : "s"} left`, warn: left <= 3, daysLeft: left };
    }
    case "active":
    case "past_due": {
      const left = days(account.paid_until);
      if (left === null) return { live: true, label: account.status === "past_due" ? "Payment due" : "Active", warn: account.status === "past_due", daysLeft: null };
      if (left + GRACE_DAYS <= 0) return { live: false, label: "Your plan has ended", warn: true, daysLeft: 0 };
      if (left <= 0) return { live: true, label: `Renew within ${left + GRACE_DAYS} day${left + GRACE_DAYS === 1 ? "" : "s"} to keep online orders running`, warn: true, daysLeft: left };
      return { live: true, label: `Paid until ${new Date(Date.parse(account.paid_until ?? "")).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`, warn: left <= 5 || account.status === "past_due", daysLeft: left };
    }
    case "suspended":
      return { live: false, label: "Account suspended", warn: true, daysLeft: 0 };
    default:
      return { live: false, label: "Account cancelled", warn: true, daysLeft: 0 };
  }
}

/** True when the plan includes the feature and the account is live. No account means older data: allowed. */
export function hasFeature(account: Account | null | undefined, plan: Plan | null | undefined, feature: PlanFeature, now = Date.now()): boolean {
  if (!account) return true;
  return accountState(account, now).live && Boolean(plan?.features[feature]);
}

/** Room for another outlet on this plan. */
export function canAddOutlet(plan: Plan | null | undefined, outlets: number): boolean {
  return outlets < (plan?.max_outlets ?? 1);
}

/** Lower-case web address part, as the database accepts it. */
export function slugify(text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/g, "");
  return slug || "restaurant";
}

export function slugError(slug: string): string {
  if (!slug) return "Enter a web address.";
  if (slug.length < 2) return "Use at least 2 characters.";
  if (slug.length > 40) return "Use 40 characters or fewer.";
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) return "Use lower-case letters, numbers and dashes, not starting or ending with a dash.";
  return "";
}

/** Monthly recurring revenue from paying accounts, in rupees (per-outlet prices). */
export function monthlyRevenue(accounts: { planId: string; status: AccountStatus; live: boolean; outlets: unknown[] }[], plans: Plan[]): number {
  const price = new Map(plans.map((p) => [p.id, p.monthly_price]));
  return accounts
    .filter((a) => a.status === "active" && a.live)
    .reduce((sum, a) => sum + (price.get(a.planId) ?? 0) * Math.max(1, a.outlets.length), 0);
}
