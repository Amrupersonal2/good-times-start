# Components

Component catalog for **Good Times Start**. Import all components from `@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d`.

### AppInstall

```ts
import { AppInstall } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### AppShell

```ts
import { AppShell } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### AuthProvider

```ts
import { AuthProvider } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### BrandEditor

```ts
import { BrandEditor } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### Button

```ts
import { Button } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

**Props:**

| Prop | Type | Default |
|---|---|---|
| `variant` | default · destructive · outline · secondary · ghost · link | `default` |
| `size` | default · sm · lg · icon | `default` |
| `asChild` | boolean | `false` |

### ConfirmButton

```ts
import { ConfirmButton } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### Constants

```ts
import { Constants } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### Dialog

```ts
import { Dialog } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### DialogClose

```ts
import { DialogClose } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### DialogContent

```ts
import { DialogContent } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### DialogDescription

```ts
import { DialogDescription } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### DialogFooter

```ts
import { DialogFooter } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### DialogHeader

```ts
import { DialogHeader } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### DialogOverlay

```ts
import { DialogOverlay } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### DialogPortal

```ts
import { DialogPortal } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### DialogTitle

```ts
import { DialogTitle } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### DialogTrigger

```ts
import { DialogTrigger } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### Dropdown

```ts
import { Dropdown } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

**Props:**

| Prop | Type | Default |
|---|---|---|
| `value` | any | `—` |
| `onChange` | function | `—` |
| `options` | any | `—` |
| `placeholder` | string | `Choose` |
| `ariaLabel` | string | `—` |
| `size` | sm · md | `md` |
| `searchable` | boolean | `—` |
| `disabled` | boolean | `—` |
| `className` | string | `ml-2 text-xs opacity-60` |

### GuestOrdersButton

```ts
import { GuestOrdersButton } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### IncomingKotWatcher

```ts
import { IncomingKotWatcher } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### InstallButton

```ts
import { InstallButton } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### KotTicket

```ts
import { KotTicket } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### LiveSync

```ts
import { LiveSync } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### LoginsSettings

```ts
import { LoginsSettings } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### MarketingResults

```ts
import { MarketingResults } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### MenuAdvisor

```ts
import { MenuAdvisor } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

Use on owner-only restaurant Insights surfaces to review sales and menu data before requesting recommendations. Requires authenticated owner membership and an internet connection.

**Props:**

| Prop | Type | Default |
|---|---|---|
| `restaurantId` | string | `—` |
| `from` | number | `—` |
| `to` | number | `—` |

**Examples:**

_Owner menu analysis_
```tsx
<MenuAdvisor restaurantId={user.restaurantId} from={range.from} to={range.to} />
```

**Avoid:**

- Do not expose analysis to non-owner restaurant members.
- Never pass customer details or credentials in supplied sales data.
- Never automatically apply AI suggestions to menu prices or orders.

### MenuExcel

```ts
import { MenuExcel } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### OrderingSettings

```ts
import { OrderingSettings } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

Use in the signed-in Business Manager to configure guest channels, inspect cloud menu/table readiness, and generate public table QR codes.

**Props:**

| Prop | Type | Default |
|---|---|---|
| `ref` | any | `—` |

**Examples:**

_Guest ordering settings_
```tsx
<OrderingSettings className="max-w-5xl" />
```

**Avoid:**

- Do not mount without the app account, auth and query providers.
- Never generate printed QR links from an editor or localhost origin.
- Do not interpret UPI references as verified payment.

### PaymentPanel

```ts
import { PaymentPanel } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### PersistentFrame

```ts
import { PersistentFrame } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### PinGate

```ts
import { PinGate } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### PolicySync

```ts
import { PolicySync } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### Popover

```ts
import { Popover } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### PopoverAnchor

```ts
import { PopoverAnchor } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### PopoverContent

```ts
import { PopoverContent } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### PopoverTrigger

```ts
import { PopoverTrigger } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### PreloadScreens

```ts
import { PreloadScreens } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### PrintHost

```ts
import { PrintHost } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### QrKit

```ts
import { QrKit } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### ReasonPrompt

```ts
import { ReasonPrompt } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### Receipt

```ts
import { Receipt } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### RolesSettings

```ts
import { RolesSettings } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### SalesSummary

```ts
import { SalesSummary } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### Segmented

```ts
import { Segmented } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### Select

```ts
import { Select } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### SelectContent

```ts
import { SelectContent } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### SelectGroup

```ts
import { SelectGroup } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### SelectItem

```ts
import { SelectItem } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### SelectLabel

```ts
import { SelectLabel } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### SelectScrollDownButton

```ts
import { SelectScrollDownButton } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### SelectScrollUpButton

```ts
import { SelectScrollUpButton } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### SelectSeparator

```ts
import { SelectSeparator } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### SelectTrigger

```ts
import { SelectTrigger } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### SelectValue

```ts
import { SelectValue } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### Switch

```ts
import { Switch } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### SyncScheduler

```ts
import { SyncScheduler } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### TerminalsSettings

```ts
import { TerminalsSettings } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### UpiPay

```ts
import { UpiPay } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### VegMark

```ts
import { VegMark } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

### WhatsAppCenter

```ts
import { WhatsAppCenter } from "@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d"
```

