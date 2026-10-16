import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { diagnoseSyncIssue } from "./ai-gateway/responses.server";

const inputSchema = z.object({
  description: z.string().trim().min(5).max(1200),
  errorDetails: z.string().trim().max(800).default(""),
});

export const diagnoseCloudSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: ownerRole, error } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "owner")
      .maybeSingle();
    if (error || !ownerRole) throw new Error("Only restaurant owners can request sync diagnoses.");

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI troubleshooting is temporarily unavailable.");
    const request = getRequest();
    const diagnosis = await diagnoseSyncIssue({
      request,
      apiKey,
      description: data.description,
      errorDetails: data.errorDetails,
    });
    if (!diagnosis.trim()) throw new Error("No diagnosis was returned. Please try again later.");
    return { diagnosis };
  });