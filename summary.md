## Regression: 239 passed, 0 flaky, 2 failed, 0 skipped

| Check | Result | Detail |
|---|---|---|
| guest QR order reaches the POS, is accepted, and syncs to another device | unexpected | Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4173/order/tab-bistro?s=e2e |
| a waiter taking an order holds the table; others see it; emptying it frees the table | unexpected | Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4173/waiter?app=waiter |
