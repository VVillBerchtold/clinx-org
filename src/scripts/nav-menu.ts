/**
 * The menus are <details> and work without this file: the phone menu, and the 340B list in the
 * header. This only adds ways to close them: the Escape key, a tap anywhere outside, and, for
 * the list in the header, moving on with the keyboard.
 */
const menus = [...document.querySelectorAll<HTMLDetailsElement>('.nav-menu, .nav-drop')];

if (menus.length > 0) {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const menu of menus) {
      if (!menu.open) continue;
      menu.open = false;
      menu.querySelector('summary')?.focus();
    }
  });
  document.addEventListener('click', (event) => {
    for (const menu of menus) {
      if (menu.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    }
  });
  for (const menu of menus) {
    if (!menu.classList.contains('nav-drop')) continue;
    menu.addEventListener('focusout', (event) => {
      if (event.relatedTarget instanceof Node && !menu.contains(event.relatedTarget)) menu.open = false;
    });
  }
}
