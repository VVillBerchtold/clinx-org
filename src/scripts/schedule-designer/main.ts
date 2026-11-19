// Schedule Designer: the page. This file owns the frame of four steps, the bar along the bottom
// and the warning about unsaved work. Each step draws itself from its own file.
//
// Everything happens in this tab. The page opens no connection, and the schedule lives in memory
// until the person saves it as a workbook. The browser keeps nothing unless the person asks it to
// remember their file, and then it keeps the file's name, where it is and the date it was last
// used here (see remember.ts).
import { announce, byId, el, fill, plural } from './dom';
import { app, dirty, go, redo, showEdited, subscribe, undo } from './state';
import { closeDropdown } from './dropdown';
import type { StepNumber, Why } from './state';
import { drawStart, initStart, setupFromSay } from './step-start';
import { initKept } from './kept';
import { drawDesign, initDesign } from './design';
import { sitWeek } from './design-week';
import { drawSetup, initSetup } from './step-setup';
import { backToFinding, drawCheck, initCheck } from './step-save';
import { check } from './engine/index';
import { checkSay } from './check-say';
import { watchRequests } from './wire';

const STEP_NAMES = ['Start', 'Set up', 'Design', 'Check and save'];
const NEXT_SAY = ['Continue', 'Design the week', 'Check and save', ''];

function drawFrame(): void {
  const s = app.schedule;
  for (const button of byId('sd-steps').querySelectorAll<HTMLButtonElement>('.cc-stepper')) {
    const n = Number(button.dataset['go']);
    const current = n === app.step;
    button.classList.toggle('is-current', current);
    button.classList.toggle('is-done', !current && (app.done.has(n) || (n === 1 && s !== null)));
    button.disabled = n > 1 && s === null;
    if (current) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
  for (let n = 1; n <= 4; n++) byId(`sd-step-${n}`).hidden = n !== app.step;
  byId('sd-where').textContent = `Step ${app.step} of 4: ${STEP_NAMES[app.step - 1] ?? ''}`;
  byId('sd').classList.toggle('is-design', app.step === 3);

  const saved = byId('sd-saved');
  saved.hidden = s === null;
  saved.classList.toggle('is-dirty', dirty());
  fill(saved, el('span', { class: 'sd-saved-dot', 'aria-hidden': 'true' }), dirty() ? 'Unsaved changes' : app.fileName ? 'Saved' : 'No changes to save');

  // The line on Set up that says where a new schedule's set-up came from, until it is dismissed.
  byId('sd-from').hidden = app.setupFrom === '';
  byId('sd-from-say').textContent = app.setupFrom === '' ? '' : setupFromSay(app.setupFrom);

  // With no schedule open the Start step has nothing to go back or on to, so the bar is not drawn.
  const foot = byId('sd-foot');
  foot.hidden = app.step === 1 && s === null;
  const back = byId<HTMLButtonElement>('sd-back');
  const next = byId<HTMLButtonElement>('sd-next');
  back.hidden = app.step === 1;
  next.hidden = app.step === 4 || s === null;
  byId('sd-next-say').textContent = NEXT_SAY[app.step - 1] ?? '';

  const tally = byId('sd-tally');
  tally.classList.toggle('is-toast', app.toast !== null);
  if (app.toast) {
    const again = app.toast.undo ? el('button', { type: 'button', class: 'cc-link', 'data-k': 'toast-undo' }, 'Undo') : null;
    again?.addEventListener('click', () => {
      if (undo()) announce('Undone.');
    });
    tally.removeAttribute('title');
    fill(tally, el('span', {}, app.toast.say), again);
    return;
  }
  let say: string;
  if (!s) say = '';
  else if (app.step === 1) say = `${app.fileName || s.name} is open.`;
  else if (app.step === 2) say = `${plural(s.people.length, 'person', 'people')}, ${plural(s.sites.length, 'site')}`;
  else if (app.step === 3) say = s.clinic || s.name;
  else say = `${checkSay(s, check(s)).short}.`;
  // A long name is kept to two lines here, so the whole of it is also given on hover.
  if (say.length > 40) tally.title = say;
  else tally.removeAttribute('title');
  // A status region is read out when it is written, so the same words are not written twice.
  if (tally.childElementCount > 0 || tally.textContent !== say) fill(tally, say);
}

/**
 * Start, with a schedule open: the bar along the bottom is drawn, and it can cover the three
 * buttons of the cards. When the cards fit in the window above the bar, the page moves by the
 * little it takes to show them whole. The cards carry the bar's height as their lower scroll margin.
 */
function clearBar(): void {
  const foot = byId('sd-foot');
  const cards = byId('sd-step-1').querySelector<HTMLElement>('.sd-starts');
  if (foot.hidden || !cards) return;
  const room = foot.getBoundingClientRect().top;
  const box = cards.getBoundingClientRect();
  if (box.bottom > room && box.height < room) cards.scrollIntoView({ block: 'nearest' });
}

function draw(why: Why, focus: boolean): void {
  // A list left open belongs to a control that is about to be drawn again.
  closeDropdown();
  drawFrame();
  if (app.step === 1) drawStart();
  else if (app.step === 2) drawSetup(why);
  else if (app.step === 3) drawDesign(why);
  else if (app.step === 4) drawCheck();
  if (why === 'step' && focus) {
    // Check and save, after "Show it": the step opens on the finding that was shown.
    if (app.step === 4 && backToFinding()) {
      announce(`Step 4 of 4: ${STEP_NAMES[3] ?? ''}`);
      return;
    }
    const heading = byId(`sd-h-${app.step}`);
    heading.focus({ preventScroll: true });
    const frame = byId('sd');
    // Design goes to the top of the window from its own bar down, so that the week and the bar along the bottom both fit.
    if (app.step === 3) {
      byId('sd-design').scrollIntoView({ block: 'start' });
      // On a phone the page goes on to the strip with Look, Add and Erase, so the week is on the first screen.
      sitWeek();
    }
    else if (frame.getBoundingClientRect().top < 0) frame.scrollIntoView({ block: 'start' });
    if (app.step === 1) clearBar();
    announce(`Step ${app.step} of 4: ${STEP_NAMES[app.step - 1] ?? ''}`);
  }
}

function start(): void {
  byId('sd-off').hidden = true;
  byId('sd').hidden = false;
  subscribe(draw);
  initStart();
  initSetup();
  initDesign();
  initCheck();
  initKept();

  byId('sd-steps').addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('.cc-stepper');
    if (!button || button.disabled) return;
    const step = Number(button.dataset['go']) as StepNumber;
    if (step === 3) showEdited();
    go(step);
  });
  byId('sd-back').addEventListener('click', () => {
    if (app.step > 1) go((app.step - 1) as StepNumber);
  });
  byId('sd-next').addEventListener('click', () => {
    if (app.step >= 4) return;
    // From Set up, Design opens on the week of the person who was changed there.
    showEdited();
    go((app.step + 1) as StepNumber);
  });

  byId('sd-from-close').addEventListener('click', () => {
    app.setupFrom = '';
    drawFrame();
    byId('sd-h-2').focus({ preventScroll: true });
  });

  // A clash note floats just above the bar along the bottom, however tall the bar is at this width.
  const foot = byId('sd-foot');
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => byId('sd').style.setProperty('--sd-foot-h', `${foot.offsetHeight}px`)).observe(foot);

  // Undo and its opposite work on every step. Inside a text box the keys belong to the typing.
  document.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || app.step === 1 || !app.schedule) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.matches('input, textarea, select')) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      if (undo()) announce('Undone.');
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      if (redo()) announce('Done again.');
    }
  });

  // Leaving the page with work that is not in a file yet: the browser asks first.
  window.addEventListener('beforeunload', (event) => {
    if (!dirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  drawFrame();
  drawStart();
  watchRequests();
}

start();
