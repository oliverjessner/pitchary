import { expect } from "@playwright/test";

export async function expectTimelineMarkers(timeline, count) {
  await expect(timeline).toHaveAttribute("role", "list");
  await expect(timeline.getByRole("listitem")).toHaveCount(count);
  const entries = await timeline.getByRole("listitem").evaluateAll((items) =>
    items.map((item) => {
      const marker = getComputedStyle(item, "::before");
      const separator = getComputedStyle(item, "::after");
      return {
        markerContent: marker.content,
        markerWidth: parseFloat(marker.width),
        markerHeight: parseFloat(marker.height),
        markerRadius: parseFloat(marker.borderRadius),
        markerColor: marker.backgroundColor,
        separatorContent: separator.content,
        separatorWidth: parseFloat(separator.borderBlockStartWidth),
        overflows: item.scrollWidth > item.clientWidth + 1,
      };
    }),
  );
  for (const [index, entry] of entries.entries()) {
    expect(entry.markerContent).toBe('""');
    expect(entry.markerWidth).toBeGreaterThanOrEqual(6);
    expect(entry.markerHeight).toBe(entry.markerWidth);
    expect(entry.markerRadius).toBeGreaterThanOrEqual(entry.markerWidth / 2);
    expect(entry.markerColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(entry.markerColor).not.toBe("transparent");
    expect(entry.overflows).toBe(false);
    if (index > 0) {
      expect(entry.separatorContent).toBe('""');
      expect(entry.separatorWidth).toBeGreaterThan(0);
    } else {
      expect(entry.separatorContent).toBe("none");
    }
  }
}
