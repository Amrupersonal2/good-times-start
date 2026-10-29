# Good Times Start — Guidelines

## Components

The design system exports these components — import them from `@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d` and compose them before building anything from scratch:

`Button`, `DialogClose`, `DialogContent`, `DialogDescription`, `DialogFooter`, `DialogHeader`, `DialogOverlay`, `DialogPortal`, `DialogTitle`, `DialogTrigger`, `Dialog`, `Dropdown`, `SelectContent`, `SelectGroup`, `SelectItem`, `SelectLabel`, `SelectScrollDownButton`, `SelectScrollUpButton`, `SelectSeparator`, `SelectTrigger`, `SelectValue`, `Select`, `Switch`, `VegMark`

Per-component details (import stanzas, props, variants, examples) live in `.lovable/rules/libraries/{slug}/components.md` — on disk, not auto-loaded. Read that file or the component source when the name alone isn't enough.

## Theme Files

The design system's theme is delivered through the following files. The author's original source files carry the full wiring the design system needs — variable declarations, framework-specific directives, provider objects, etc. — and are the canonical import target.

- `@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d/styles.css` (source — preferred import)
- `@ws-ml8w3ceizoxcbfhy3qtb/1af0545d-85c8-432a-9d4a-b2302a6aa07d/dist/tokens.css` (auto-generated flat list of CSS custom properties — a raw-values fallback only; does NOT carry framework-specific wiring that the source files above provide)

