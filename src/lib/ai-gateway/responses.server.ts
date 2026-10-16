import { createOpenAI } from "@ai-sdk/openai";
import { streamText, type ModelMessage } from "ai";
import { createLovableAiGatewayRunIdFetch, getLovableAiGatewayRunId } from "./run-id";

export async function diagnoseSyncIssue(input: {
  request: Request;
  apiKey: string;
  description: string;
  errorDetails: string;
}) {
  const runIdFetch = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(input.request));
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey: input.apiKey,
    headers: {
      "Lovable-API-Key": input.apiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
    fetch: runIdFetch.fetch,
  });
  const messages: ModelMessage[] = [{
    role: "user",
    content: `Manager's description: ${input.description}\n\nDisplayed sync error: ${input.errorDetails || "Not provided"}`,
  }];
  const result = streamText({
    model: provider.responses("openai/gpt-6-astra"),
    system: "You are a practical troubleshooting assistant for managers using an offline-first restaurant POS. Diagnose only likely causes from the supplied description and sync error. Return three short sections: Likely cause, What to check, Safe next steps. State uncertainty plainly; never claim you inspected their system. Do not recommend deleting or overwriting local sales data, exposing credentials, or retrying repeatedly. Remind them IndexedDB is the offline source of truth and that AI suggestions do not perform repairs. Use plain language and concise steps.",
    messages,
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
  });
  return result.text;
}