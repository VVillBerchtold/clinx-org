/**
 * Progressive enhancement only. Without this script every figure and bar is already on the page.
 * - `[data-play]`: gets the class `play` the first time it scrolls into view (bars grow once).
 * - `[data-count]`: the number counts up once, to the value already printed in the page.
 * Nothing runs for readers who ask for reduced motion.
 */

const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function countUp(el: HTMLElement): void {
  const live = el.querySelector<HTMLElement>('.count-live');
  const target = Number((el.dataset['count'] ?? '').replaceAll(',', ''));
  if (!live || !Number.isFinite(target)) return;
  const final = live.textContent ?? '';
  const decimals = (final.split('.')[1] ?? '').length;
  const show = (value: number): string => value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const duration = 1100;
  const started = performance.now();
  const frame = (now: number): void => {
    const t = Math.min(1, (now - started) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    live.textContent = t < 1 ? show(target * eased) : final;
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

if (!still && 'IntersectionObserver' in window) {
  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        seen.unobserve(el);
        if (el.dataset['count'] !== undefined) countUp(el);
        else el.classList.add('play');
      }
    },
    { threshold: 0.25 },
  );
  document.querySelectorAll<HTMLElement>('[data-play], [data-count]').forEach((el) => seen.observe(el));
}
