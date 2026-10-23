---
name: VÉRRO Gallery & Atelier
colors:
  canvas: '#F2EBDD'
  surface: '#E8DDC9'
  charcoal: '#171717'
  gold: '#B08A4A'
  navy: '#173A5E'
  oxblood: '#641F23'
typography:
  display-xl:
    fontFamily: Bodoni Moda
    fontSize: clamp(2rem, 1.25rem + 3.5vw, 4.25rem)
    fontWeight: '400'
    lineHeight: 1.08
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Bodoni Moda
    fontSize: clamp(1.75rem, 1.2rem + 2.2vw, 3rem)
    fontWeight: '400'
    lineHeight: 1.15
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Bodoni Moda
    fontSize: clamp(1.35rem, 1rem + 1.2vw, 2rem)
    fontWeight: '400'
    lineHeight: 1.25
    letterSpacing: 0em
  headline-sm:
    fontFamily: Bodoni Moda
    fontSize: clamp(1.15rem, 0.95rem + 0.8vw, 1.5rem)
    fontWeight: '400'
    lineHeight: 1.35
    letterSpacing: 0.01em
  body-lg:
    fontFamily: Space Grotesk
    fontSize: clamp(1rem, 0.95rem + 0.3vw, 1.125rem)
    fontWeight: '300'
    lineHeight: 1.8
    letterSpacing: 0.01em
  body-md:
    fontFamily: Space Grotesk
    fontSize: 0.9375rem
    fontWeight: '400'
    lineHeight: 1.625rem
    letterSpacing: 0.01em
  body-sm:
    fontFamily: Space Grotesk
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.45rem
    letterSpacing: 0.015em
  label-uppercase:
    fontFamily: Space Grotesk
    fontSize: 0.6875rem
    fontWeight: '500'
    lineHeight: 1rem
    letterSpacing: 0.15em
  label-meta:
    fontFamily: Space Grotesk
    fontSize: 0.75rem
    fontWeight: '500'
    lineHeight: 1.125rem
    letterSpacing: 0.14em
  mono-archival:
    fontFamily: IBM Plex Mono
    fontSize: 0.6875rem
    fontWeight: '400'
    lineHeight: 1.125rem
    letterSpacing: 0.14em
spacing:
  gutter: 2rem
  gutter-mobile: 1rem
  margin: 4rem
  margin-mobile: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 2rem
  space-xl: 3.5rem
  space-2xl: 6rem
---

## Brand & Style

This design system establishes a high-fashion editorial gallery catalog aesthetic for curated digital wallpapers and physical atelier surfaces. The experience merges the tactile restraint of heavyweight archival print with the responsive precision of modern digital media.

### Visual Character & Identity
- **Atmosphere:** Archival, cerebral, and uncompromisingly luxurious. It recalls international contemporary art biennials, printed monographic catalogues, and quiet gallery environments.
- **Design Philosophy:** Minimalist Editorial with architectural structure. Compositional tension is created through uncrowded spatial fields, disciplined hairline divisions, asymmetric column arrangements, and commanding typographic scale shifts.
- **Surface Materiality:** Subdued warm undertones reminiscent of raw linen and calcium plaster replace sterile white digital planes. Surfaces layer naturally without synthetic drop shadows or rounded corners.

## Colors

The palette is derived from classic museum conservation materials: raw parchment, oxidized mineral pigments, and archival ink.

### Palette Architecture
- **Primary (`#B08A4A` - Antique Gold):** Reserved for deliberate highlights, active pagination states, curated edition badges, and focused interactions. Never overused as solid full-bleed background fills.
- **Secondary (`#173A5E` - Deep Navy):** Deep maritime undertone used for curatorial subheadings, bespoke metadata tags, and formal contrast against parchment planes.
- **Tertiary (`#641F23` - Deep Oxblood):** Applied to archival markers, limited edition stamps, sale flags, and selective typographic accents.
- **Neutral Primary (`#171717` - Charcoal):** Replaces pure black to avoid digital harshness. Governs primary typographic hierarchies, strict hairline structural borders, and deep canvas blocks.
- **Canvas Base (`#F2EBDD` - Warm Ivory):** The default root canvas, giving the entire viewport the appearance of heavyweight rag paper.
- **Surface Layer (`#E8DDC9` - Soft Parchment):** Used for elevated art plaques, filter bars, drawer backdrops, and secondary content blocks.

## Typography

The typographic hierarchy is built strictly upon a three-tier system: Bodoni Moda, Space Grotesk, and IBM Plex Mono.

### Typographic Directives
- **Primary Luxury Display (Bodoni Moda):** Governs the VÉRRO wordmark, hero masthead, major section headlines, collection titles, wallpaper titles, and editorial statements. Rendered in light to regular weights (`400`) to evoke high-fashion folios, avoiding heavy or bold treatments.
- **Modern Interface & Body (Space Grotesk):** Governs navigation, body text, buttons, descriptions, and feature specifications. Employs light (`300`), regular (`400`), and medium (`500`) weights with restrained tracking (`0.12em`–0.18em) for uppercase labels to create a sharp contemporary contrast against Bodoni Moda.
- **Archival Micro-Detail (IBM Plex Mono):** Used very sparingly for catalogue numbering, archive references, format tags (`MAC + IPHONE`), plate indices (`PLATE 01`), and small technical markers. Treated as an archival museum stamp, never used for headlines or running copy.

## Layout & Spacing

Layouts follow an asymmetric architectural grid system inspired by Swiss book design and exhibition staging.

### Grid & Composition
- **Desktop Grid:** 12-column layout with `2rem` gutters and generous `4rem` outer canvas margins. Artwork features often occupy unconventional column spans (e.g., 5-column primary visual paired with an offset 3-column curatorial essay and 4-column whitespace buffer).
- **Tablet Grid:** 8-column layout with `1.5rem` gutters and `2.5rem` canvas margins.
- **Mobile Grid:** 4-column layout with `1rem` gutters and `1.5rem` margins. Complex horizontal pairings collapse into single-column flows punctuated by horizontal rule separators.
- **Whitespace Allocation:** Whitespace functions as a structural element. Sections are spaced using `space-xl` and `space-2xl` increments to ensure artworks never visually compete with adjacent panels.

## Elevation & Depth

This system avoids simulated lighting drop shadows, Skeuomorphic bevels, and blurred glass materials. Depth is produced strictly through tonal layering and structural rules.

### Depth Mechanics
- **Tonal Stepping:** Layering occurs purely through parchment tonal transitions: the canvas base (`#F2EBDD`) accommodates secondary cards and flyout panels tinted in Soft Parchment (`#E8DDC9`). Inverted presentation modules use solid Charcoal (`#171717`) with Warm Ivory typography.
- **Hairline Framing:** Crisp 1px structural outlines (`rgba(23, 23, 23, 0.12)`) establish spatial boundaries for tables, artwork frames, and toolbars.
- **Modal & Drawer Overlays:** Dialogues and slide-out exhibition drawers appear flush over a warm semi-translucent scrim (`rgba(23, 23, 23, 0.45)`). They carry sharp outer borders with zero corner radii and zero blur shadows.

## Shapes

The design language enforces an absolute zero-radius policy (`roundedness: 0`). Every structural container, image wrapper, interactive button, form input, chip, and dialog window terminates in clean 90-degree corners. This evokes matted museum frames, architectural plans, and pristine book trimming.

## Components

### Buttons & Action Links
- **Primary Button:** Solid Charcoal (`#171717`) background with Warm Ivory (`#F2EBDD`) typography. Sharp edges, 0px border radius, 14px vertical padding and 28px horizontal padding. Text in `label-uppercase` style. On hover, background shifts smoothly to Antique Gold (`#B08A4A`).
- **Secondary / Outlined Button:** Transparent background framed with a 1px border of Charcoal or Antique Gold. Charcoal text in `label-uppercase`. On hover, fills with Charcoal while text flips to Warm Ivory.
- **Text Link / Curatorial Action:** Space Grotesk uppercase label accompanied by a thin trailing arrow or em-dash (`—`), underlined with a 1px offset hairline.

### Chips & Filter Tags
- **Design:** Compact rectangular boxes, zero border radius, surrounded by a 1px hairline border (`#171717` at 20% opacity).
- **Active State:** Solid Charcoal surface with Warm Ivory typography, or Antique Gold hairline border with Antique Gold text.
- **Inactive State:** Parchment-matched background with Charcoal text at 70% opacity.

### Artwork & Wallpaper Display Cards
- **Image Treatment:** Aspect ratios match classical architectural proportions (3:4, 4:5, or 1:1). Images sit flush within sharp boundaries with optional 1px hairline parchment matte margins.
- **Metadata Placement:** Positioned cleanly underneath the imagery. Display the piece title in Bodoni Moda (`headline-sm`), followed by a two-column typographic breakdown in Space Grotesk uppercase (`label-meta`) showing medium, year, color profile, and edition status.

### Form Inputs & Text Fields
- **Input Style:** Clean baseline-only or full 1px hairline framed boxes. Zero border radius. Background tinted in Soft Parchment (`#E8DDC9`).
- **Labeling:** Floating or static uppercase metadata labels (`label-uppercase`) positioned above the input field with wide character tracking.
- **Focus State:** Active border turns to Antique Gold (`#B08A4A`) with no exterior focus ring glow.

### Checkboxes & Radio Controls
- **Form:** Strictly square checkboxes (0px radius) and square selector chips for radios, honoring the zero-roundedness rule.
- **Selected State:** Solid Charcoal field enclosing a centered Antique Gold inner square dot or minimalist crosshair mark.

### Exhibition Specimen Lists
- **Structure:** Divided by 1px horizontal hairline rules (`rgba(23, 23, 23, 0.1)`).
- **Layout:** Monospaced catalogue numbering in IBM Plex Mono (e.g., `001 // CAT`), artwork title in Bodoni Moda, collection metadata in Space Grotesk, and terminal acquisition link aligned to the far right.