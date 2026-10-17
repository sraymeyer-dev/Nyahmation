/**
 * Scrolls a list just enough (up or down only) to show a row, as when a part
 * picked on the canvas is shown in the Layers list and the timeline.
 * `covered` is the height hidden under a header that stays at the top.
 */
export function revealRow(scroller: HTMLElement, row: Element, covered = 0): void {
  const view = scroller.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  const top = view.top + scroller.clientTop + covered;
  const bottom = view.top + scroller.clientTop + scroller.clientHeight;
  if (r.top < top) scroller.scrollTop -= top - r.top;
  else if (r.bottom > bottom) scroller.scrollTop += Math.min(r.bottom - bottom, r.top - top);
}
