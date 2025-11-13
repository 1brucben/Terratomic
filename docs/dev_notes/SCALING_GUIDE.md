# Resolution-Responsive Scaling Guide for Developers

## Overview

This project uses a **rem-based scaling system** where the root `html` font-size changes at different screen width breakpoints. All UI dimensions scale proportionally with the root, ensuring crisp text rendering and consistent relative sizing across all resolutions.

**Key Principle:** All measurements must use `rem` units or CSS tokens so they scale automatically with the root font-size.

---

## Quick Reference

### Current Breakpoints

| Screen Width  | Root Font Size | Scale Factor | Target Devices         |
| ------------- | -------------- | ------------ | ---------------------- |
| ≥1920px       | 16px           | 100%         | 1080p+ displays        |
| 1600px–1919px | 12px           | 75%          | 1600×900, 1680×1050    |
| 1440px–1599px | 10px           | 62.5%        | 1440×900               |
| 1280px–1439px | 9px            | 56.25%       | 1366×768, 1280×720/800 |
| <1280px       | 8px            | 50%          | Small laptops, tablets |

### CSS Tokens Available

```css
/* Font Sizes */
--font-xs: 0.6875rem; /* 11px @ 16px root */
--font-sm: 0.75rem; /* 12px */
--font-base: 0.875rem; /* 14px */
--font-md: 1rem; /* 16px */
--font-lg: 1.25rem; /* 20px */

/* Spacing */
--space-1: 0.25rem; /* 4px */
--space-2: 0.5rem; /* 8px */
--space-3: 0.75rem; /* 12px */
--space-4: 1rem; /* 16px */
--space-5: 1.25rem; /* 20px */
--space-6: 1.5rem; /* 24px */
--space-7: 1.75rem; /* 28px */
--space-8: 2rem; /* 32px */

/* Border Radius */
--radius-xs: 0.125rem; /* 2px */
--radius-sm: 0.25rem; /* 4px */
--radius-md: 0.5rem; /* 8px */
--radius-lg: 0.75rem; /* 12px */
--radius-xl: 1rem; /* 16px */
```

### Semantic Font Classes

```css
.font-xs      /* Maps to --font-xs (11px) */
.font-sm      /* Maps to --font-sm (12px) */
.font-base    /* Maps to --font-base (14px) */
.font-md      /* Maps to --font-md (16px) */
.font-lg      /* Maps to --font-lg (20px) */

/* Density helpers */
.font-dense   /* Same as .font-sm, for tight layouts */
.font-micro   /* Same as .font-xs, for very compact text */
```

---

## Rules for New Components

### ✅ DO: Use rem Units

**For all dimensional properties:**

```typescript
// ✅ GOOD - Uses rem units
const styles = css`
  width: 20rem; /* 320px @ 16px root */
  height: 12.5rem; /* 200px @ 16px root */
  padding: 1rem 1.5rem; /* 16px 24px @ 16px root */
  margin: 0.5rem; /* 8px @ 16px root */
  border: 0.125rem solid; /* 2px @ 16px root */
  border-radius: 0.5rem; /* 8px @ 16px root */
  gap: 0.75rem; /* 12px @ 16px root */
  font-size: 0.875rem; /* 14px @ 16px root */
`;
```

**Conversion formula from design:**

```
rem value = pixel value / 16
```

Examples:

- 320px → 320 / 16 = **20rem**
- 24px → 24 / 16 = **1.5rem**
- 12px → 12 / 16 = **0.75rem**
- 2px → 2 / 16 = **0.125rem**

### ✅ DO: Use CSS Tokens When Available

```typescript
// ✅ GOOD - Uses tokens for common values
const styles = css`
  gap: var(--space-3); /* 12px */
  padding: var(--space-2); /* 8px */
  border-radius: var(--radius-md); /* 8px rounded corners */
  font-size: var(--font-base); /* 14px text */
`;
```

### ✅ DO: Use Semantic Font Classes

```typescript
// ✅ GOOD - In template literals (Lit components)
return html`
  <div class="font-base">Normal text</div>
  <span class="font-sm">Small caption</span>
  <h2 class="font-lg">Larger heading</h2>
  <div class="font-micro">Very compact info</div>
`;
```

### ❌ DON'T: Use Fixed Pixel Values

```typescript
// ❌ BAD - Fixed pixels don't scale
const styles = css`
  width: 320px; /* Will be huge on small screens */
  padding: 16px 24px; /* Won't scale proportionally */
  font-size: 14px; /* Won't scale with root */
`;
```

### ❌ DON'T: Use Tailwind text-\* Utilities

```typescript
// ❌ BAD - Tailwind text utilities don't scale with root changes
return html`
  <div class="text-sm">This won't scale</div>
  <div class="text-base">This won't scale either</div>
`;

// ✅ GOOD - Use semantic font classes instead
return html`
  <div class="font-sm">This scales properly</div>
  <div class="font-base">This scales properly too</div>
`;
```

### ❌ DON'T: Use Transform Scaling on UI Panels

```typescript
// ❌ BAD - Transform scaling causes blur and media query isolation
const styles = css`
  transform: scale(0.9); /* Causes text blur */
  transform-origin: bottom left;
`;

// ❌ BAD - Don't use ui-scale-surface class
return html` <div class="ui-scale-surface">Content</div> `;

// ✅ GOOD - Use rem units and let root scaling handle it
const styles = css`
  /* No transform needed - rem units scale automatically */
  width: 20rem;
  height: 15rem;
`;
```

---

## Working with Existing Tailwind Classes

Some Tailwind utilities are safe to use because they scale with rem:

### ✅ Safe to Use (Already rem-based)

```typescript
// These Tailwind classes use rem internally and will scale:
class="p-4"        // padding: 1rem
class="m-2"        // margin: 0.5rem
class="gap-3"      // gap: 0.75rem
class="w-64"       // width: 16rem
class="h-48"       // height: 12rem
class="rounded-lg" // border-radius: 0.5rem
```

### ⚠️ Use with Caution (May need semantic alternatives)

```typescript
// Tailwind text utilities are rem-based BUT don't scale when html font-size changes
// Replace with semantic classes:
class="text-sm"    → class="font-sm"
class="text-base"  → class="font-base"
class="text-lg"    → class="font-lg"
```

### ✅ Arbitrary Values in Tailwind

```typescript
// ✅ GOOD - Using rem in arbitrary Tailwind values
class="w-[20rem]"           // width: 20rem
class="h-[12.5rem]"         // height: 12.5rem
class="p-[1.5rem]"          // padding: 1.5rem
class="gap-[0.75rem]"       // gap: 0.75rem
class="rounded-[0.5rem]"    // border-radius: 0.5rem

// ❌ BAD - Using px in arbitrary values
class="w-[320px]"           // Won't scale!
class="h-[200px]"           // Won't scale!
```

---

## Common Patterns and Examples

### Creating a Modal

```typescript
const styles = css`
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-content {
    background: var(--ui-modal-content);
    border: 0.125rem solid var(--ui-panel-border);  /* 2px border */
    border-radius: var(--radius-lg);                /* 12px rounded */
    padding: 1.5rem 2rem;                           /* 24px 32px */
    max-width: 40rem;                               /* 640px max */
    min-width: 25rem;                               /* 400px min */
    box-shadow: 0 0.5rem 2rem rgba(0, 0, 0, 0.3);  /* 0 8px 32px */
  }

  .modal-title {
    font-size: var(--font-lg);   /* 20px */
    margin-bottom: var(--space-4); /* 16px */
    font-weight: bold;
  }

  .modal-body {
    font-size: var(--font-base);  /* 14px */
    line-height: 1.5;
  }

  .modal-button {
    padding: 0.75rem 1.5rem;      /* 12px 24px */
    border-radius: var(--radius-sm); /* 4px */
    font-size: var(--font-base);  /* 14px */
    margin-top: var(--space-4);   /* 16px */
  }
`;

render() {
  return html`
    <div class="modal-overlay">
      <div class="modal-content">
        <h2 class="modal-title">Modal Title</h2>
        <div class="modal-body font-base">
          Modal content here
        </div>
        <button class="modal-button">Close</button>
      </div>
    </div>
  `;
}
```

### Creating a Button Component

```typescript
const styles = css`
  .custom-button {
    /* Dimensions in rem */
    width: 10rem;              /* 160px @ 16px root */
    height: 3rem;              /* 48px @ 16px root */
    padding: 0.75rem 1.5rem;   /* 12px 24px @ 16px root */

    /* Spacing/borders in rem */
    border: 0.125rem solid var(--ui-button-border);  /* 2px */
    border-radius: var(--radius-md);                 /* 8px */
    gap: 0.5rem;               /* 8px gap between icon and text */

    /* Font size using token */
    font-size: var(--font-base); /* 14px */

    /* Shadows in rem */
    box-shadow:
      0 0.125rem 0.25rem rgba(0, 0, 0, 0.1),        /* 0 2px 4px */
      inset 0 0 0.625rem rgba(255, 255, 255, 0.05); /* inset glow */

    transition: all 0.2s ease;
  }

  .custom-button:hover {
    transform: translateY(-0.125rem);  /* 2px lift on hover */
    box-shadow: 0 0.25rem 0.5rem rgba(0, 0, 0, 0.15); /* 0 4px 8px */
  }

  .button-icon {
    width: 1.25rem;   /* 20px icon */
    height: 1.25rem;
  }
`;

render() {
  return html`
    <button class="custom-button font-base">
      <img class="button-icon" src="icon.svg" alt="" />
      <span>Button Text</span>
    </button>
  `;
}
```

### Creating a Panel with Sliders

```typescript
const styles = css`
  .stat-panel {
    width: 20rem;                    /* 320px */
    padding: var(--space-3);         /* 12px */
    background: var(--ui-panel-bg);
    border: 0.125rem solid var(--ui-panel-border);
    border-radius: var(--radius-lg);  /* 12px */
    gap: var(--space-4);             /* 16px */
  }

  .stat-label {
    font-size: var(--font-sm);       /* 12px */
    margin-bottom: var(--space-1);   /* 4px */
  }

  .slider-track {
    height: 0.5rem;                  /* 8px */
    border-radius: 0.25rem;          /* 4px */
    background: var(--ui-slider-track);
  }

  input[type="range"]::-webkit-slider-thumb {
    width: 1rem;                     /* 16px thumb */
    height: 1rem;
    border-radius: 50%;
    border-width: 0.125rem;          /* 2px border */
  }
`;

render() {
  return html`
    <div class="stat-panel">
      <label class="stat-label font-sm">Attack Ratio</label>
      <input type="range" min="0" max="100" />
    </div>
  `;
}
```

---

## Testing Your Changes

### Required Testing

**Always test your UI changes at multiple resolutions:**

1. **1920×1080** (100% scale) - Should look "perfect"
2. **1600×900** (75% scale) - Most common laptop resolution
3. **1440×900** (62.5% scale) - Test for proportion
4. **1366×768** (56.25% scale) - Minimum readable target
5. **1280×720** (56.25% scale) - Compact but functional

### Browser DevTools Method

```
1. Open Chrome DevTools (F12)
2. Toggle device toolbar (Ctrl+Shift+M)
3. Set custom dimensions:
   - 1920×1080
   - 1600×900
   - 1440×900
   - 1366×768
   - 1280×720
4. Verify:
   ✅ Text is crisp and readable
   ✅ Elements maintain proportions
   ✅ No text overflow or clipping
   ✅ Spacing looks consistent
   ✅ No overlapping elements
```

### What to Look For

#### ✅ Good Scaling Behavior

- All elements shrink/grow proportionally
- Text remains crisp (no blur)
- Relative spacing is maintained
- Buttons remain clickable with adequate hit areas
- No horizontal scrollbars on panels

#### ❌ Signs of Problems

- Text appears blurry → You're using transforms
- Some elements don't scale → They're using px values
- Text overflows containers → Container or text not using rem
- Elements overlap → Fixed positioning with px values
- Inconsistent spacing → Mixed px and rem units

---

## Common Mistakes and Solutions

### Problem: Component doesn't scale at different resolutions

```typescript
// ❌ PROBLEM
const styles = css`
  .my-component {
    width: 400px; // Fixed pixels
    padding: 20px; // Fixed pixels
  }
`;

// ✅ SOLUTION
const styles = css`
  .my-component {
    width: 25rem; // 400px / 16 = 25rem
    padding: 1.25rem; // 20px / 16 = 1.25rem
  }
`;
```

### Problem: Text doesn't scale with container

```typescript
// ❌ PROBLEM
return html` <div class="text-sm">This text won't scale</div> `;

// ✅ SOLUTION
return html` <div class="font-sm">This text scales properly</div> `;
```

### Problem: Modal/panel appears blurry on smaller screens

```typescript
// ❌ PROBLEM - Transform causes subpixel rendering
const styles = css`
  .panel {
    transform: scale(0.9);
  }
`;

// ✅ SOLUTION - Use rem units, no transform
const styles = css`
  .panel {
    width: 18rem; // Adjust size in rem instead
    height: 13.5rem;
  }
`;
```

### Problem: Mixing units causes inconsistent scaling

```typescript
// ❌ PROBLEM - Inconsistent units
const styles = css`
  .card {
    width: 20rem; // Scales with root
    padding: 16px; // Fixed, doesn't scale
    margin: 1rem; // Scales with root
    border-radius: 8px; // Fixed, doesn't scale
  }
`;

// ✅ SOLUTION - All rem units
const styles = css`
  .card {
    width: 20rem; // Scales
    padding: 1rem; // Scales (16px / 16)
    margin: 1rem; // Scales
    border-radius: 0.5rem; // Scales (8px / 16)
  }
`;
```

### Problem: Hard to calculate complex rem values

```typescript
// Use inline comments to document the px equivalent

const styles = css`
  .complex-layout {
    width: 23.4375rem; /* 375px */
    height: 15.9375rem; /* 255px */
    padding: 0.875rem 1.25rem; /* 14px 20px */
    gap: 0.6875rem; /* 11px */
  }
`;

// Or use CSS calc() for clarity
const styles = css`
  .complex-layout {
    width: calc(375rem / 16); /* 23.4375rem */
    padding: calc(14rem / 16) calc(20rem / 16); /* 0.875rem 1.25rem */
  }
`;
```

---

## Modifying Breakpoints (Advanced)

### If you need to adjust breakpoints:

**File:** `src/client/styles.css`

```css
/* Current breakpoints (don't change without team discussion) */
@media (min-width: 1920px) {
  html {
    font-size: 16px !important;
  }
}
@media (max-width: 1919px) and (min-width: 1600px) {
  html {
    font-size: 12px !important;
  }
}
@media (max-width: 1599px) and (min-width: 1440px) {
  html {
    font-size: 10px !important;
  }
}
@media (max-width: 1439px) and (min-width: 1280px) {
  html {
    font-size: 9px !important;
  }
}
@media (max-width: 1279px) {
  html {
    font-size: 8px !important;
  }
}
```

**Important:** Changing these values affects the entire UI. Always:

1. Discuss with the team first
2. Test at ALL resolutions
3. Update this documentation
4. Document the reason for the change

---

## Adding New CSS Tokens

### If you need new spacing/font/radius values:

**File:** `src/client/styles.css`

```css
:root {
  /* Add new tokens here */
  --space-9: 2.25rem; /* 36px - if you need a larger gap */
  --font-xl: 1.5rem; /* 24px - if you need larger text */
  --radius-2xl: 1.25rem; /* 20px - if you need more rounding */
}
```

**Then update:** `src/client/styles/core/typography.css` if adding font utilities

```css
.font-xl {
  font-size: var(--font-xl);
}
```

---

## Checklist for Code Review

When reviewing PRs that add/modify UI components:

- [ ] All dimensional properties use `rem` units or tokens
- [ ] No hardcoded `px` values (except 1px borders if necessary)
- [ ] No transform scaling on UI panels (`scale()`, `ui-scale-surface`)
- [ ] Text uses semantic classes (`.font-*`) not Tailwind `text-*`
- [ ] Includes inline comments showing px equivalents for complex rem values
- [ ] Component tested at 1920×1080, 1600×900, 1440×900, 1366×768
- [ ] No text overflow or element overlap at any breakpoint
- [ ] Text renders crisp (not blurry) at all resolutions

---

## Resources

- **Conversion calculator:** `rem = px / 16`
- **Test resolutions:** 1920×1080, 1600×900, 1440×900, 1366×768, 1280×720
- **CSS tokens:** See `:root` in `src/client/styles.css`
- **Semantic fonts:** See `src/client/styles/core/typography.css`
- **Original refactor commit:** `4ef0507b` on `resolution-scaling-magic` branch
- **Full documentation:** `COMMIT_MESSAGE.md` in project root

---

## Questions?

If you're unsure about how to implement scaling for a specific component:

1. Look at existing components like `ResearchTreeModal.ts`, `BuildMenu.ts`, or `ControlPanel.ts` for reference
2. Use the patterns in this guide
3. Test at multiple resolutions
4. Ask the team if you're still uncertain

**Remember:** When in doubt, use `rem` units and CSS tokens. This ensures your component will scale properly across all screen sizes! 🎯
