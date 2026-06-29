---
name: tailwind4
description: "Tailwind CSS v4 reference for breaking changes. Trigger whenever writing or reviewing Tailwind classes, CSS files with Tailwind directives, PostCSS config, or any styling code. This project uses Tailwind v4 which has a completely different config model, renamed utilities, and changed defaults from v3."
---

# Tailwind CSS v4 — Breaking Changes Reference

This project uses **Tailwind CSS v4** with `@tailwindcss/postcss`. The config model and many utility names changed from v3.

---

## CSS Entry Point

```css
/* v3 */
@tailwind base;
@tailwind components;
@tailwind utilities;

/* v4 */
@import "tailwindcss";
```

---

## PostCSS Config

```js
// v3
plugins: { tailwindcss: {} }

// v4
plugins: { "@tailwindcss/postcss": {} }
```

Remove `postcss-import` and `autoprefixer` — v4 handles these automatically.

---

## Renamed Utilities

| v3 | v4 |
|---|---|
| `shadow-sm` | `shadow-xs` |
| `shadow` | `shadow-sm` |
| `rounded-sm` | `rounded-xs` |
| `outline-none` | `outline-hidden` |
| `ring` (3px default) | `ring-3` |
| `blur-sm` | `blur-xs` |
| `flex-shrink-*` | `shrink-*` |
| `flex-grow-*` | `grow-*` |
| `bg-gradient-to-r` | `bg-linear-to-r` |
| `bg-gradient-to-br` | `bg-linear-to-br` |

Angle-based gradients are now supported directly: `bg-linear-45`, `bg-linear-135`, etc.

---

## Removed Opacity Utilities

These are gone — use the `/` modifier instead:

```html
<!-- v3 -->
<div class="bg-opacity-50 text-opacity-75 border-opacity-25">

<!-- v4 -->
<div class="bg-black/50 text-black/75 border-black/25">
```

---

## Default Value Changes

**Ring:**
- Default width: 3px → **1px**
- Default color: blue-500 → **currentColor**

```html
<!-- v3 behavior -->
<button class="ring ring-blue-500">

<!-- v4 equivalent -->
<button class="ring-3 ring-blue-500">
```

**Border color:** Changed from `gray-200` to `currentColor` — add explicit color:

```html
<div class="border border-gray-200">
```

---

## Syntax Changes

**Important modifier moves to end:**
```html
<!-- v3 -->
<div class="!flex !bg-red-500">

<!-- v4 -->
<div class="flex! bg-red-500!">
```

**CSS variables in arbitrary values:**
```html
<!-- v3 -->
<div class="bg-[--brand-color]">

<!-- v4 -->
<div class="bg-(--brand-color)">
```

**Grid column commas → underscores:**
```html
<!-- v3 -->
<div class="grid-cols-[max-content,auto]">

<!-- v4 -->
<div class="grid-cols-[max-content_auto]">
```

---

## Configuration

JavaScript config files no longer auto-detect. Load explicitly in CSS if needed:

```css
@config "../../tailwind.config.js";
```

For new config, use CSS-first `@theme` blocks instead of `tailwind.config.js`.

---

## Removed

- `corePlugins` option
- `safelist` in JS config (use `@source inline()` instead)
- CSS preprocessors (Sass, Less, Stylus)
- `resolveConfig` function
