# Table-first POS, kitchen tickets, and sync recovery

## Research summary

The current POS has a menu grid beside a bill, but dine-in table selection lives inside the bill panel; orders and KOTs are only saved when payment settles. Zoho POS for Restaurants presents table service as a linked flow: live floor/table state, table-associated orders, and kitchen tickets routed to stations. Its help material also describes table ordering, live order value, station routing, and modifier-aware kitchen communication. The “Zylker” reference is a Zoho example restaurant/workflow, not a separate POS product. I found similarly named Zayka/Zaayka products, but they are not the reference requested.

Research references:
- [Zoho POS for Restaurants](https://www.zoho.com/en-in/pos/restaurants/)
- [Zoho POS: ways to use it](https://www.zoho.com/en-in/pos/restaurants/resources/help/ways-to-use-zoho-pos.html)
- [Zoho POS: features comparison](https://www.zoho.com/en-in/pos/restaurants/features-list.html)
- [Zoho POS: modifiers](https://www.zoho.com/en-in/pos/restaurants/resources/help/modifiers.html)
- [ZaykaBill, a separate similarly named product](https://zaykabill.com/)

## What to build

1. **Table-first order taking:** Start dine-in ordering by choosing a table from the floor/table view. Open its active order in the billing workspace, with menu search/categories and the selected-items panel visible together. Keep the selected table and unsent draft available after refresh and offline; show table state and running total, and let staff add further items to the same order.
2. **Kitchen ticket before customer bill:** Add an explicit “Send to kitchen / Print KOT” action before settlement. Save the order and station-split KOTs locally first, print a kitchen-format ticket with table/order context, item quantities and notes, and prevent already-sent lines from being sent twice. Keep customer receipt printing as a separate post-settlement action. Continue operating if the printer or network is unavailable, with a clear retry path.
3. **Manager sync status and recovery:** Provide a focused sync-status view for signed-in owners/managers: pending order count, last successful sync, current connectivity, last sync failure and a plain-language next action, plus a manual retry. Persist sync metadata locally so the panel remains useful offline. Keep IndexedDB authoritative and sync eligible signed-in data to Lovable Cloud.
4. **AI sync diagnosis:** Let an authenticated manager describe what happened and optionally include the displayed sync error. Return likely causes, confidence/uncertainty, and a practical recovery checklist through Lovable AI Gateway. Do not send auth tokens, customer details, or full order payloads; do not let AI automatically alter records or retry sync. Validate and limit submitted text on both sides, and enforce manager access on the server function.
5. **Tests and end-to-end verification:** Add targeted tests for KOT submission/idempotency and offline draft persistence where existing test patterns allow; verify selecting a table → adding items → sending/printing KOT → settling → printing the customer receipt, plus sync status/diagnosis behavior and a clean build.

## Technical approach

- Preserve Dexie/IndexedDB as the offline source of truth; add a versioned local schema for durable draft/KOT submission and last-sync metadata.
- Reuse existing `Order`, `Kot`, `RestaurantTable`, billing, kitchen, and authentication patterns where possible; separate KOT printing from the existing receipt print view.
- Use the existing owner role as the manager permission boundary unless a distinct manager role already exists in the role system. Authenticate and authorize again in the AI server function; never rely on hiding a button.
- Keep AI Gateway credentials and model requests server-side. Use the project’s default model and follow its streaming, validation, and safe error-handling contract.
- Update the active POS roadmap as each deliverable is completed.

## Scope boundary

This plan covers the table-to-order-to-kitchen-to-bill workflow and actionable cloud-sync recovery. It does not add real hardware printer drivers, external aggregator APIs, QR/customer ordering, or new subscription/restaurant configuration flows.
