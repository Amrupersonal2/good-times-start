/**
 * WhatsApp Business Platform (Meta Cloud API). Server only: the access token
 * never reaches a browser. Off until WHATSAPP_ACCESS_TOKEN and
 * WHATSAPP_PHONE_NUMBER_ID are set as secrets in Lovable Cloud.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export function whatsappKeys(): { token: string; phoneId: string } | null {
  const token = process.env["WHATSAPP_ACCESS_TOKEN"];
  const phoneId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
  return token && phoneId ? { token, phoneId } : null;
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string; retry: boolean };

/**
 * Send one approved template message. Marketing messages to guests must use a
 * template approved in WhatsApp Manager; {{1}}, {{2}}… in its body are filled
 * from bodyParams in order.
 */
export async function sendTemplate(keys: { token: string; phoneId: string }, input: {
  to: string; template: string; language: string; bodyParams: string[];
}): Promise<SendResult> {
  const body = {
    messaging_product: "whatsapp",
    to: input.to,
    type: "template",
    template: {
      name: input.template,
      language: { code: input.language },
      ...(input.bodyParams.length ? { components: [{ type: "body", parameters: input.bodyParams.map((text) => ({ type: "text", text: text.slice(0, 200) })) }] } : {}),
    },
  };
  let response: Response;
  try {
    response = await fetch(`${GRAPH}/${encodeURIComponent(keys.phoneId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${keys.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, error: "Couldn't reach WhatsApp", retry: true };
  }
  const json = await response.json().catch(() => null) as { messages?: { id: string }[]; error?: { message?: string; code?: number } } | null;
  if (response.ok && json?.messages?.[0]?.id) return { ok: true, id: json.messages[0].id };
  const code = json?.error?.code;
  // 131047/131026: outside the window or not on WhatsApp; 132xxx: template problems. Not worth retrying.
  const retry = response.status === 429 || response.status >= 500 || code === 130429 || code === 131056;
  return { ok: false, error: (json?.error?.message ?? `WhatsApp said ${response.status}`).slice(0, 200), retry };
}
