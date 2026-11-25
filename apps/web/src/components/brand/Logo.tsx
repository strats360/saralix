/**
 * The Saralix mark (the folded S). Traced from the brand artwork in branding/; it takes the
 * current text colour, so it's black on light, white on dark, or whatever its tile sets.
 */
const MARK = "M625 318L980 178L978 252C977 282 960 302 935 310L776 369Z M572 337C586 347 600 353 618 358L930 457C972 470 1000 505 1000 543C1000 564 992 582 978 598C971 592 963 588 955 586L605 475C568 463 545 432 545 395C545 368 556 348 572 337Z M547 767L548 703C549 670 568 645 596 635L768 564L933 616Z";

export function SaralixMark({ size = 20, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg viewBox="472 172 600 600" width={size} height={size} className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path fill="currentColor" d={MARK} />
    </svg>
  );
}

/** The mark on its tile: black with a white mark, off-white with a black mark in dark mode. */
export function SaralixTile({ size = 34, inverse = false }: { size?: number; inverse?: boolean }) {
  return (
    <div
      className="grid flex-none place-items-center rounded-[var(--radius-md)]"
      style={{ width: size, height: size, background: inverse ? "var(--color-neutral-100)" : "var(--color-primary-bg)", color: inverse ? "var(--color-neutral-900)" : "var(--color-primary-fg)" }}
    >
      <SaralixMark size={Math.round(size * 0.68)} />
    </div>
  );
}
