# GHP Platform Design System

## 1. Visual Theme & Atmosphere

The GHP Platform implements the **"Antigravity" Design Language** — a sophisticated, premium aesthetic that transitions away from rigid, utilitarian dark modes into an immersive, highly polished digital environment. The design feels both weightless and grounded, anchored by deep navy backgrounds, luminous gold accents, and glassmorphic layers that create an intuitive sense of depth.

The typography relies on a dual-typeface system tailored for precision and readability. Manrope (display sizes) and Inter (body sizes) provide a structured, geometric clarity. At display sizes, tight line-heights and negative letter-spacing create an impactful, modern feel. The typography pairs seamlessly with dynamic animations, allowing the data and content to breathe within the rich, layered environment.

**Key Characteristics:**
- **Antigravity Glassmorphism**: Cards and panels use frosted glass treatments (`backdrop-filter: blur(24px) saturate(180%)`) over dark navy plates.
- **Dark Navy Basis**: The core background (`#0a1118`) provides endless depth, giving the interface a cinematic scale.
- **Sophisticated Gold Accents**: Interactive elements, primary actions, and hero highlights rely on a curated gold palette (`#e5bb76` to `#cfa45d`), replacing generic primary colors.
- **Dynamic Living Interfaces**: Subtle micro-animations (like the background Aura, glowing golden hover states, and smooth number rollups) make the interface feel alive and responsive.
- **Data-as-Hero without Imagery**: The platform avoids generic hero imagery, instead focusing on sweeping, beautiful data presentations, typography, and a custom text-based logo.

---

## 2. Color Palette & Roles

### Base & Surfaces
- **Dark Navy Background** (`#0a1118`): `--background`. The endless canvas. Used for the main body and layout foundations.
- **Glass Panel Surface** (`rgba(10, 17, 24, 0.6)`): `--card`. Primary content housing. Features deep blur and inner edge-lighting.
- **Elevated Surface** (`rgba(20, 30, 45, 0.6)`): `--surface-elevated`. For popovers, dropdowns, and high-z-index overlays.
- **Popover Solid** (`#0f1620`): `--popover`. Used where glassmorphism might reduce legibility (e.g., dense data tooltips).

### Brand & Accents
- **Sophisticated Gold** (`#e5bb76`): `--primary`, `--chart-1`. The main brand anchor. Used for primary text emphasis, active states, and glowing accents.
- **Deeper Gold** (`#cfa45d`): `--accent`, `--chart-2`. Used for gradients and secondary visual depth.
- **Rich Bronze/Gold** (`#a37f3f`): `--chart-3`. Used in data visualizations.
- **Soft Gold Tint** (`rgba(229, 187, 118, 0.2)`): `--border`. Gives structural lines a subtle, premium warmth instead of stark gray.

### Text
- **Primary Text** (`#ffffff`): `--foreground`. High contrast readability on navy and glass.
- **Secondary Text** (`rgba(255, 255, 255, 0.6)`): `--muted-foreground`. Metadata, secondary context, inactive tabs.
- **Gold Text** (`#e5bb76`): `--secondary-foreground`. Used in key graphical flourishes, hover states, and brand-gradient texts.

### Semantic (Financial)
- **Positive** (`#30d158`): `--color-positive`. Gains, beats, bullish signals.
- **Negative** (`#ff453a`): `--color-negative`, `--destructive`. Losses, misses, bearish signals.

---

## 3. Typography Rules

### Font Family
- **Display**: `Manrope` (variable `--font-heading`), with fallbacks: `system-ui, -apple-system, sans-serif`
- **Body**: `Inter` (variable `--font-sans`), with fallbacks: `system-ui, -apple-system, sans-serif`
- **Monospace/Data**: `Geist Mono` (variable `--font-geist-mono`), for financial figures and tabular grids

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|----------------|-------|
| Display Hero | Manrope | 48px (3.00rem) | 700 | 1.07 (tight) | -0.02em | High-impact page titles or total values |
| Section Heading | Manrope | 36px (2.25rem) | 600 | 1.10 (tight) | -0.02em | Major content divisions |
| Card Heading | Manrope | 24px (1.50rem) | 600 | 1.14 (tight) | -0.015em| Widget and glass panel titles |
| Sub-heading | Manrope | 20px (1.25rem) | 500 | 1.19 (tight) | -0.01em | Categorical grouping within cards |
| Body | Inter | 16px (1.00rem) | 400 | 1.47 | -0.01em | Standard long-form reading |
| Body Emphasis | Inter | 16px (1.00rem) | 600 | 1.24 (tight) | -0.01em | Active state labels, firm data |
| Caption | Inter | 14px (0.875rem) | 400 | 1.29 (tight) | 0.01em | Minor text, timestamp |
| Small Label | Inter | 12px (0.75rem) | 600 | 1.33 | 0.05em | All-caps, wide-tracked micro categories |
| Metric Value | Geist Mono| 36px (2.25rem) | 600 | 1.00 | -0.02em | Key KPI data that rolls up on mount |
| Data Cell | Geist Mono| 14px (0.875rem) | 400 | 1.43 | 0 | Tabular numeric data streams |

*(Note: Size values collapse intuitively at mobile breakpoints.)*

---

## 4. Component Stylings

### Glass Panels & Cards (`.glass-panel`)
The signature structural element of the system.
- **Background**: `rgba(10, 17, 24, 0.6)`
- **Backdrop**: `blur(24px) saturate(180%)`
- **Border**: 1px solid `rgba(229, 187, 118, 0.2)`
- **Shadow/Edge**: Outer shadow `0 16px 32px 0 rgba(0,0,0,0.5)`, combined with a crisp inner top-edge highlight `inset 0 1px 0 0 rgba(255,255,255,0.05)`.
- **Corner Radius**: Extensively uses rounded corners (e.g., `12px` / `rounded-xl`).

### Buttons
**Primary Gold Glow CTA (`.glow-primary-button`)**
- Uses a rich diagonal gradient: `linear-gradient(135deg, var(--primary), var(--accent))`
- Text color is solid black (`#000000`) for maximum legibility against the gold brightness.
- Emits a gold box-shadow aura: `0 0 20px -5px var(--primary)`
- **Hover**: Transforms up slightly (`translateY(-1px)`), increases brightness (`1.2`), and expands the aura radius.

**Secondary / Ghost Actions**
- Background: Transparent or slight wash (`rgba(229, 187, 118, 0.1)`)
- Text: Gold (`#e5bb76`)
- Border: `1px solid rgba(229, 187, 118, 0.2)`

### Forms & Input
- Background: `rgba(255, 255, 255, 0.1)` overlaid on navy
- Focus Ring: Rings leverage the gold palette (`#e5bb76`) heavily, providing a distinct, warm glow around inputs.

### Special Text
- **Brand Gradient Text (`.brand-gradient-text`)**: Shimmering gradient text for high-importance marketing copy or logos, clipping the gold gradient explicitly to the text fill.

---

## 5. Motion & Animations

Animation is not an afterthought; it is structurally required to make the glassmorphism perform.

1. **Aura Background (`.animate-aura`)**
   - Slow, organic 20-second breathing cycle of sweeping gradients or radial orbs positioned behind the glass plates.
   - Ranges in opacity and subtly scales and translates to emulate environmental light movement.

2. **Number Rollups (`.animate-number`)**
   - Hero statistics enter via a cinematic `number-rollup` keyframe (TranslateY 20px out to 0px, scaling blur from 8px to 0px).
   - Occurs over 1 second, utilizing an assertive `cubic-bezier(0.16, 1, 0.3, 1)` easing.

3. **Reactions (`.animate-float-up`)**
   - Emojis or user feedback icons float upward over 1 second, easing out, pushing -80px linearly while scaling up and fading out.

4. **Interactive Transitions**
   - General element bounds (like cards or inputs) use `200ms ease-out` for hover color and scale manipulations.

---

## 6. Layout Principles & Spacing

To honor the "Antigravity" effect, elements must have room to float.
- Avoid tightly clustering panels. Use generous exterior padding to allow the Dark Navy background and Aura lights to pool around the glass components.
- Rely on the inner borders and shadows of the `.glass-panel` rather than horizontal rules or heavy structural dividers.

---

## 7. Do's and Don'ts

### Do
- Ensure all major interface blocks sit upon a `.glass-panel` class or utilize identical `backdrop-filter: blur(24px)` settings.
- Utilize the `.brand-gradient-text` for the GHP text logo or marquee headlines.
- Give the `Dark Navy` base background the breathing room it needs to invoke scale.
- Animate key metrics using the `.animate-number` class on first mount.

### Don't
- Don't use flat grays or standard white backgrounds, which visually break the glassmorphic depth.
- Don't lean on generic primary blues or purples—maintain the strict Navy / Gold dynamic.
- Don't clutter the layout with hero images; the typography and the glass panels *are* the hero imagery.
- Don't remove the inner highlight on glass panels; it's essential for defining the shape's geometry against dark backgrounds.
