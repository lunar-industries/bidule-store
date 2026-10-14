// Whether a terminal's tabs, side by side, fit where the strip may spread: their own widths, the gaps between them
// and the strip's padding against the room it has. A pixel's rounding is no reason to give up the row.
export function tabsFit(widths: number[], room: number, gap = 0, padding = 0): boolean {
  if (!widths.length) return true
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * (widths.length - 1) + padding
  return total <= room + 0.5
}

// The room the strip has beside the other controls of a row: what they and the gaps between them leave.
export function roomBeside(width: number, others: number[], gap = 0): number {
  return Math.max(0, width - others.reduce((sum, w) => sum + w, 0) - gap * others.length)
}

// On the banner's edge the strip spreads up to this: the other tools and the mascot keep their place.
export const bannerCap = (windowWidth: number) => Math.min(760, windowWidth * 0.6)
