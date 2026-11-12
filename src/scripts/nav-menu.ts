/**
 * The phone menu is a <details> and works without this file. This only adds two ways to close
 * it: the Escape key, and a tap anywhere outside it.
 */
const menu = document.querySelector<HTMLDetailsElement>('.nav-menu');

if (menu) {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary')?.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (menu.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
  });
}
