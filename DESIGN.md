---
name: SteamBee
description: A quiet self-hosted operations console for Steam account automation.
colors:
  canvas: "#eef1f4"
  surface: "#ffffff"
  surface-subtle: "#f6f8fb"
  ink: "#101720"
  muted: "#657380"
  border: "#d9e0e8"
  brand: "#ffc857"
  accent: "#d99821"
  success: "#16845b"
  info: "#2e6ea9"
  warning: "#a96c00"
  danger: "#bd3c31"
  focus: "#5e8fca"
typography:
  body:
    fontFamily: "Inter, Aptos, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, Aptos, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "normal"
  wordmark:
    fontFamily: "Bodoni 72 Smallcaps, Bodoni 72, Didot, Georgia, serif"
    fontSize: "21px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "normal"
rounded:
  control: "6px"
  panel: "8px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
    height: "36px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
    height: "36px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "16px"
---

## Overview

SteamBee is an operational tool for repeated use. Its visual hierarchy must make account state, active work, failures, and required actions easy to scan. Layouts are compact and structured, with stable dimensions for controls and status elements. The product name is a clear first-viewport signal, while the application itself remains the first screen.

The interface supports light, dark, narrow, and right-to-left contexts without changing its character. Responsive changes should preserve task order and expose core settings rather than hiding them. Motion is functional, brief, and removed when the operating system requests reduced motion.

## Colors

The neutral canvas and white surfaces establish a quiet workspace. Ink provides the primary action color in light mode, while the warm yellow brand color identifies SteamBee and becomes the primary control color in dark mode. Green, blue, amber, and red are semantic colors and must not be used as interchangeable decoration.

Every state must remain understandable without color alone. Text and interactive states target WCAG 2.2 AA contrast. Avoid one-hue screens, decorative gradients, translucent color blobs, and low-contrast muted copy. Dark mode should use equivalent semantic roles rather than a simple inversion.

## Typography

Use the system sans-serif stack for all operational content. Keep body text at a stable size; do not scale it with viewport width. Labels and table metadata can be smaller when contrast and line height remain sufficient. The serif small-caps face is reserved for the SteamBee wordmark and must not spread to headings or controls.

Headings inside panels should be compact and proportional to their context. Use weight, spacing, and grouping before increasing size. Letter spacing remains normal so translated and right-to-left text does not become fragile.

## Elevation

Borders and surface changes carry most separation. Ordinary panels and repeated items should not float; use restrained or no shadow. A stronger shadow is reserved for modal dialogs and menus that genuinely sit above the page. Focus rings are visible on every keyboard-interactive element and must not be replaced by elevation.

Hover and active states may shift background or border color without moving layout. Avoid nested cards, large diffuse shadows, glass effects, and decorative floating sections.

## Components

Buttons use icons from the existing icon library for familiar actions and include text only when the command is not self-evident. Icon-only buttons require an accessible name and tooltip. Inputs, selects, and buttons share a stable 36px control height unless a larger touch target is needed on narrow screens.

Status indicators pair semantic color with a textual label. Tabs represent views, segmented controls represent mutually exclusive modes, and switches or checkboxes represent binary settings. Dialogs use modal semantics, Escape handling, focus containment, focus restoration, and scroll locking. Destructive confirmation is always in-app and names the object affected.

Dense account, game, event, and schedule views should use unframed sections or individual repeated rows. Cards are reserved for discrete records, dialogs, and genuinely framed tools; cards must not contain other cards.

## Do's and Don'ts

Do keep the active account and system condition visible. Do preserve controls on mobile through a compact settings menu. Do localize browser-visible state from stable codes and retain server text only as fallback. Do design empty, loading, stale, offline, and error states as part of every workflow.

Do not create a marketing landing page inside the application. Do not hide critical settings solely because the viewport is narrow. Do not use native browser confirmations for product workflows. Do not animate continuously or rely on motion to communicate state. Do not introduce decorative artwork where operators need inspectable data.
