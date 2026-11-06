// Consumer-safe design-system barrel: only self-contained controls belong
// here. App-coupled components (AppShell, AppInstall, LiveSync, receipts,
// payment dialogs, settings screens) import the database client, auth
// context and other app internals, so exporting them would break consumers.
import "./styles.css"
export { Dropdown, type DropdownOption } from "./components/Dropdown"
export { VegMark } from "./components/VegMark"
export { Button } from "./components/ui/button"
export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectLabel, SelectItem, SelectSeparator, SelectScrollUpButton, SelectScrollDownButton } from "./components/ui/select"
export { Switch } from "./components/ui/switch"
export { Dialog, DialogPortal, DialogOverlay, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "./components/ui/dialog"
