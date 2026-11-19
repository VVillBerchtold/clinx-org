// Set up, the People tab: a list of people on one side and the chosen person on the other, with
// their contract hours, their clinical factor and the hours set aside for other work. The hours of
// patient care and the target in slots are worked out from those and shown as the person types.
// A person is a provider or support staff. Support staff have no slot fields. They have a list of
// the providers they work with.
import { LIMITS, addPerson, addWorksWith, blocksOf, capacityHours, departmentOf, duplicatePerson, kindChange, lengthText, personColour, personOf, removePerson, removeSetAside, removeWorksWith, setAsideHours, setKind, setPerson, setStep, slotTarget, standardsOf, supportFor } from './engine/index';
import type { Person, PersonKind, Schedule, Step } from './engine/index';
import { dot, el, icon, plural, segmented } from './dom';
import { picker } from './dropdown';
import type { Choice } from './dropdown-keys';
import { app, commit, emit, go, showPerson } from './state';
import { addButton, change, cur, field, focusNext, numberBox, onLive, optionalBox, removeButton, textBox } from './setup-parts';
import { hourSpan, percent, slotNum, slotWords } from './slots';
import { workBlock } from './setup-work';
import { canWorkWith, withChoices } from './team-say';

const clamp = (value: number, least: number, most: number): number => Math.min(most, Math.max(least, value));

/** A change of kind that would remove something waits here until the person says yes or no. */
let asking: { personId: string; kind: PersonKind } | null = null;
/** The provider whose removal from a "works with" list is waiting for an answer, because it would take time off the week. */
let askingOff: { personId: string; providerId: string } | null = null;

const KIND_SAY: Readonly<Record<PersonKind, string>> = { provider: 'Provider', support: 'Support staff' };

/** What the list of people shows on the right of a name: the slot target, or the kind for support staff, who have none. */
const whoNum = (s: Schedule, person: Person): string => (person.kind === 'support' ? 'Support staff' : slotWords(slotTarget(s, person.id)));

/** The choice between a provider and support staff. A change that would remove anything asks first and says what. */
function kindField(s: Schedule, person: Person): HTMLElement {
  const label = `Kind for ${person.name}`;
  const apply = (kind: PersonKind): void => {
    asking = null;
    focusNext(`seg:${label}:${kind}`);
    change(setKind(cur(), person.id, kind), kind === 'support' ? `${person.name} is support staff now.` : `${person.name} is a provider now.`, (count) => `That also removed ${count} of time with a provider.`);
  };
  const choice = segmented<PersonKind>(
    label,
    [
      { value: 'provider', say: KIND_SAY.provider },
      { value: 'support', say: KIND_SAY.support },
    ],
    person.kind,
    (kind) => {
      const plan = kindChange(cur(), person.id, kind);
      if (!plan.changes) return;
      if (!plan.removes) {
        apply(kind);
        return;
      }
      asking = { personId: person.id, kind };
      focusNext('kind-no');
      emit('look');
    },
  );
  const plan = asking && asking.personId === person.id ? kindChange(s, person.id, asking.kind) : null;
  let ask: HTMLElement | null = null;
  if (asking && plan && plan.changes && plan.removes) {
    const to = asking.kind;
    // The filled button is the one that keeps things as they are.
    const yes = el('button', { type: 'button', class: 'btn ghost sd-btn-sm is-danger', 'data-k': 'kind-yes' }, to === 'support' ? 'Change to support staff' : 'Change to a provider');
    const no = el('button', { type: 'button', class: 'btn accent sd-btn-sm', 'data-k': 'kind-no' }, person.kind === 'support' ? 'Keep as support staff' : 'Keep as a provider');
    yes.addEventListener('click', () => apply(to));
    no.addEventListener('click', () => {
      asking = null;
      focusNext(`seg:${label}:${person.kind}`);
      emit('look');
    });
    ask = el('div', { class: 'sd-ask', role: 'group', 'aria-label': 'Change the kind of person' }, el('p', { class: 'sd-ask-say', role: 'status' }, icon('alert', 18), el('span', {}, `${plan.say} Undo brings it back.`)), el('div', { class: 'sd-action-row' }, no, yes));
  } else if (asking && asking.personId === person.id) asking = null;
  return el(
    'div',
    { class: 'sd-field sd-kind-field' },
    el('span', { class: 'sd-field-label' }, 'Provider or support staff'),
    choice,
    el('span', { class: 'sd-field-hint' }, person.kind === 'support' ? 'Support staff have no slot target. Their week is paid hours and time with the providers they work with.' : 'A provider has a slot target. Support staff, such as a medical assistant or a nurse, have paid hours and time with providers.'),
    ask,
  );
}

/**
 * The providers a support person works with: each can be removed, and one more is added with a
 * button. Taking a provider off the list removes the time with them, so when there is any the
 * page asks first and says how much, the same way a change of kind does.
 */
/**
 * A list that adds what is chosen from it. At rest its button says the verb, with a plus, and no
 * choice in it; after a choice the part is drawn again and the button is back at rest.
 */
function addPicker(label: string, options: readonly Choice[], add: (value: string) => void): HTMLElement {
  const control = picker(label, options, '', add, 'sd-dd-add');
  control.querySelector('.sd-dd-btn')?.prepend(icon('plus', 16));
  return control;
}

function worksWithBlock(s: Schedule, person: Person): HTMLElement {
  const listed = withChoices(s, person.id).filter((one) => person.worksWith.includes(one.personId));
  const withThem = (providerId: string): { blocks: number; minutes: number } => {
    const mine = blocksOf(cur(), person.id).filter((block) => block.what.kind === 'with' && block.what.personId === providerId);
    return { blocks: mine.length, minutes: mine.reduce((sum, block) => sum + block.minutes, 0) };
  };
  if (askingOff && (askingOff.personId !== person.id || !person.worksWith.includes(askingOff.providerId) || withThem(askingOff.providerId).blocks === 0)) askingOff = null;
  const rows = listed.map((one) => {
    const takeOff = (): void => {
      askingOff = null;
      focusNext('ww-add');
      change(removeWorksWith(cur(), person.id, one.personId), `Removed ${one.name} from the “works with” list of ${person.name}.`, (count) => `That also removed ${count} of time with them.`);
    };
    let ask: HTMLElement | null = null;
    if (askingOff?.providerId === one.personId) {
      const time = withThem(one.personId);
      const yes = el('button', { type: 'button', class: 'btn ghost sd-btn-sm is-danger', 'data-k': 'ww-yes' }, 'Remove them and the time');
      const no = el('button', { type: 'button', class: 'btn accent sd-btn-sm', 'data-k': 'ww-no' }, `Keep ${one.name}`);
      yes.addEventListener('click', takeOff);
      no.addEventListener('click', () => {
        askingOff = null;
        focusNext(`ww-x:${one.personId}`);
        emit('look');
      });
      ask = el(
        'div',
        { class: 'sd-ask', role: 'group', 'aria-label': `Remove ${one.name} from the list` },
        el('p', { class: 'sd-ask-say', role: 'status' }, icon('alert', 18), el('span', {}, `Taking ${one.name} off the list removes ${plural(time.blocks, 'block')} of time with them, ${lengthText(time.minutes)} in all. Undo brings it back.`)),
        el('div', { class: 'sd-action-row' }, no, yes),
      );
    }
    return el(
      'li',
      { class: `sd-ww-row${ask ? ' is-asking' : ''}` },
      el('span', { class: 'sd-ww-name' }, dot(personColour(s, one.personId)), el('strong', {}, one.name), one.role ? el('span', {}, one.role) : null),
      removeButton(`Remove ${one.name} from the list`, `ww-x:${one.personId}`, () => {
        if (withThem(one.personId).blocks === 0) {
          takeOff();
          return;
        }
        askingOff = { personId: person.id, providerId: one.personId };
        focusNext('ww-no');
        emit('look');
      }),
      ask,
    );
  });
  const free = canWorkWith(s, person.id);
  const full = person.worksWith.length >= LIMITS.worksWith;
  // One control adds a provider: it rests as "Add a provider" with no name in it, and a choice from its list adds that provider at once.
  const adder = full
    ? el('span', { class: 'sd-field-hint' }, `The list holds ${LIMITS.worksWith} providers. Take one off to add another.`)
    : free.length > 0
      ? el(
          'div',
          { class: 'sd-aside-add' },
          addPicker('Add a provider', free.map((one) => ({ value: one.id, say: one.name, ...(one.role.trim() ? { note: one.role.trim() } : {}) })), (value) => {
            focusNext('pick:Add a provider');
            commit(addWorksWith(cur(), person.id, value));
          }),
        )
      : el('span', { class: 'sd-field-hint' }, s.people.some((other) => other.kind === 'provider') ? 'Every provider in the schedule is on the list.' : 'The schedule has no provider yet. Add a person and leave them as a provider.');
  return el(
    'section',
    { class: 'sd-ww', 'aria-label': `Providers ${person.name} works with` },
    el('p', { class: 'sd-field-label sd-wh-h' }, icon('person', 16), 'Works with'),
    rows.length > 0 ? el('ul', { class: 'sd-ww-list' }, ...rows) : el('p', { class: 'sd-field-hint' }, 'Nobody is on the list yet. Add the providers this person usually works with, and time with them can be added to the week.'),
    adder,
  );
}

function detail(s: Schedule, person: Person): HTMLElement {
  const read = (now: Schedule): Person => personOf(now, person.id) ?? person;
  const base = (): Schedule => app.schedule ?? s;
  const department = departmentOf(s, person.departmentId);

  // The sum under the hours: contract, times the clinical factor, less the hours set aside,
  // leaves the hours of patient care. Those hours, counted in slots, are the target.
  const contractOut = el('strong', {});
  const factorOut = el('strong', {});
  const asideOut = el('strong', {});
  const capacityOut = el('strong', {});
  const slotsOut = el('strong', {});
  const rateOut = el('span', {});
  const show = (now: Schedule): void => {
    const same = read(now);
    const standards = standardsOf(now, person.id);
    contractOut.textContent = hourSpan(same.contractHours);
    factorOut.textContent = percent(standards.careFactor);
    asideOut.textContent = hourSpan(same.setAside.reduce((total, line) => total + line.hours, 0));
    capacityOut.textContent = hourSpan(capacityHours(now, person.id));
    slotsOut.textContent = slotNum(slotTarget(now, person.id));
    rateOut.textContent = `target slots a week, at ${slotNum(standards.slotsPerHour)} slots an hour`;
  };
  show(s);
  onLive(() => show(base()));

  const lines = person.setAside.map((line) => {
    const activity = s.activities.find((item) => item.id === line.activityId);
    const name = activity?.name ?? 'Other time';
    return el(
      'li',
      { class: 'sd-aside' },
      el('span', { class: 'sd-aside-name' }, activity ? dot(activity.colour) : null, name, activity && !activity.paid ? el('span', { class: 'cc-chip' }, 'Unpaid') : null),
      el(
        'span',
        { class: 'sd-kind-len' },
        numberBox({
          label: `Hours a week set aside for ${name}`,
          key: `aside:${line.activityId}`,
          value: line.hours,
          least: 0,
          most: LIMITS.hours,
          step: 0.25,
          set: (now, value) => setAsideHours(now, person.id, line.activityId, value),
          read: (now) => read(now).setAside.find((item) => item.activityId === line.activityId)?.hours ?? 0,
          typing: (value) => show(setAsideHours(base(), person.id, line.activityId, clamp(value, 0, LIMITS.hours))),
        }),
        el('span', { 'aria-hidden': 'true' }, 'hours'),
      ),
      removeButton(`Remove the set-aside hours for ${name}`, `aside-x:${line.activityId}`, () => {
        focusNext('aside-add');
        commit(removeSetAside(cur(), person.id, line.activityId));
      }),
    );
  });
  const free = s.activities.filter((activity) => !person.setAside.some((line) => line.activityId === activity.id));
  // The same one control as "Add a provider": a choice from its list sets an hour aside for that kind of time, to be changed in its row.
  const adder =
    free.length > 0
      ? el(
          'div',
          { class: 'sd-aside-add' },
          addPicker('Set hours aside', free.map((activity) => ({ value: activity.id, say: activity.name })), (value) => {
            focusNext(`aside:${value}`);
            commit(setAsideHours(cur(), person.id, value, 1));
          }),
        )
      : null;

  const ramping = el('input', { type: 'checkbox', 'data-k': 'p-ramping' });
  ramping.checked = person.ramping;
  ramping.addEventListener('change', () => commit(setPerson(cur(), person.id, { ramping: ramping.checked })));

  const support = person.kind === 'support';
  const contractField = el(
    'label',
    { class: 'sd-field' },
    el('span', { class: 'sd-field-label' }, 'Contract hours a week'),
    el(
      'span',
      { class: 'sd-kind-len' },
      numberBox({
        label: 'Contract hours a week',
        key: 'p-hours',
        value: person.contractHours,
        least: 0,
        most: LIMITS.hours,
        step: 0.25,
        set: (now, value) => setPerson(now, person.id, { contractHours: value }),
        read: (now) => read(now).contractHours,
        typing: (value) => show(setPerson(base(), person.id, { contractHours: clamp(value, 0, LIMITS.hours) })),
      }),
      el('span', { 'aria-hidden': 'true' }, 'hours'),
    ),
  );
  // Who is with a provider, said in Set up too, where the list itself is kept on the support person.
  const helpers = support ? [] : supportFor(s, person.id).map((one) => one.name);

  const blocks = blocksOf(s, person.id).length;
  const design = el('button', { type: 'button', class: 'btn accent sd-btn-sm', 'data-k': 'p-design' }, 'Design this week', icon('right', 16));
  design.addEventListener('click', () => {
    showPerson(person.id);
    app.view = 'person';
    go(3);
  });
  const copy = el('button', { type: 'button', class: 'btn ghost sd-btn-sm', 'data-k': 'p-copy', disabled: s.people.length >= LIMITS.people }, icon('copy', 16), 'Make a copy');
  copy.addEventListener('click', () => {
    const next = duplicatePerson(cur(), person.id);
    const at = next.people.findIndex((item) => item.id === person.id);
    const added = next.people[at + 1];
    if (added && next !== s) {
      app.setupPersonId = added.id;
      focusNext('p-name');
    }
    commit(next, added ? { say: `Copied ${person.name} with the whole week. The copy has no rooms yet.`, undo: true } : null);
  });
  const remove = el('button', { type: 'button', class: 'btn ghost sd-btn-sm is-danger', 'data-k': 'p-remove' }, icon('trash', 16), 'Remove');
  remove.addEventListener('click', () => {
    focusNext('p-add');
    change(removePerson(cur(), person.id), `Removed ${person.name}.`, (count) => `That also removed the ${count} in their week.`);
  });

  return el(
    'section',
    { class: 'sd-panel sd-person', 'aria-label': person.name },
    el(
      'div',
      { class: 'sd-form-two' },
      field('Name', textBox({ label: 'Name', key: 'p-name', value: person.name, set: (now, value) => setPerson(now, person.id, { name: value }), read: (now) => read(now).name })),
      field('Role', textBox({ label: 'Role', key: 'p-role', value: person.role, placeholder: 'For example, Physician', set: (now, value) => setPerson(now, person.id, { role: value }), read: (now) => read(now).role })),
      el('div', { class: 'sd-field' }, el('span', { class: 'sd-field-label' }, 'Department'), picker('Department', s.departments.map((dept) => ({ value: dept.id, say: dept.name })), person.departmentId, (value) => commit(setPerson(cur(), person.id, { departmentId: value })), 'sd-select-wide'), el('span', { class: 'sd-field-hint' }, 'The department decides which visit types can be added for the person.')),
      el(
        'div',
        { class: 'sd-field' },
        el('span', { class: 'sd-field-label' }, 'Grid'),
        segmented<Step>(
          `Grid for ${person.name}`,
          [
            { value: 15, say: '15 min' },
            { value: 20, say: '20 min' },
          ],
          person.step,
          (step) => commit(setStep(cur(), person.id, step)),
        ),
        el('span', { class: 'sd-field-hint' }, 'The grid lines on this person’s week.'),
      ),
      kindField(s, person),
    ),
    // Support staff have contract hours and nothing else here: no set-aside lines, no factor of their own, no slots, no ramping.
    support ? el('div', { class: 'sd-hours-box is-support' }, el('div', { class: 'sd-hours-in' }, contractField), el('p', { class: 'sd-field-hint' }, 'The paid hours on the week are counted against these contract hours.')) : null,
    support ? worksWithBlock(s, person) : null,
    support ? null : el(
      'div',
      { class: 'sd-hours-box' },
      el(
        'div',
        { class: 'sd-hours-in' },
        contractField,
        el('div', { class: 'sd-field sd-aside-field' }, el('span', { class: 'sd-field-label' }, 'Set aside for other work'), lines.length > 0 ? el('ul', { class: 'sd-asides' }, ...lines) : el('span', { class: 'sd-field-hint' }, 'Nothing is set aside yet. Add a line for admin time or a standing meeting.'), adder),
        el(
          'label',
          { class: 'sd-field' },
          el('span', { class: 'sd-field-label' }, 'Clinical factor for this person'),
          el(
            'span',
            { class: 'sd-kind-len' },
            optionalBox({
              label: `Clinical factor for ${person.name}, as a percent. Leave it empty to use the department's.`,
              key: 'p-factor',
              value: person.careFactor === null ? null : Math.round(person.careFactor * 1000) / 10,
              usual: String(Math.round((department?.careFactor ?? 1) * 1000) / 10),
              least: LIMITS.careFactor.least * 100,
              most: LIMITS.careFactor.most * 100,
              step: 1,
              set: (now, value) => setPerson(now, person.id, { careFactor: value === null ? null : value / 100 }),
              read: (now) => {
                const own = read(now).careFactor;
                return own === null ? null : Math.round(own * 1000) / 10;
              },
              typing: (value) => show(setPerson(base(), person.id, { careFactor: value === null ? null : value / 100 })),
            }),
            el('span', { 'aria-hidden': 'true' }, '%'),
          ),
          el('span', { class: 'sd-field-hint' }, `Leave it empty to use the department’s ${percent(department?.careFactor ?? 1)}.`),
        ),
        el(
          'label',
          { class: 'sd-field' },
          el('span', { class: 'sd-field-label' }, 'Slots an hour for this person'),
          el(
            'span',
            { class: 'sd-kind-len' },
            optionalBox({
              label: `Slots an hour for ${person.name}. Leave it empty to use the department's.`,
              key: 'p-slots',
              value: person.slotsPerHour,
              usual: slotNum(department?.slotsPerHour ?? 3),
              least: LIMITS.slotsPerHour.least,
              most: LIMITS.slotsPerHour.most,
              step: 0.5,
              set: (now, value) => setPerson(now, person.id, { slotsPerHour: value }),
              read: (now) => read(now).slotsPerHour,
              typing: (value) => show(setPerson(base(), person.id, { slotsPerHour: value })),
            }),
            el('span', { 'aria-hidden': 'true' }, 'slots'),
          ),
          el('span', { class: 'sd-field-hint' }, `Leave it empty to use the department’s ${slotNum(department?.slotsPerHour ?? 3)}.`),
        ),
      ),
      el(
        'div',
        { class: 'sd-target', role: 'status', 'aria-label': 'How the target is made' },
        el(
          'div',
          { class: 'sd-target-sum' },
          el('span', { class: 'sd-target-part' }, contractOut, el('span', {}, 'contract')),
          el('span', { class: 'sd-target-op', 'aria-hidden': 'true' }, '×'),
          el('span', { class: 'sd-target-part' }, factorOut, el('span', {}, 'clinical factor')),
          el('span', { class: 'sd-target-op', 'aria-hidden': 'true' }, '−'),
          el('span', { class: 'sd-target-part' }, asideOut, el('span', {}, 'set aside')),
          // The equals sign and the answer stay together, so a narrow strip never leaves the answer alone on a line.
          el('span', { class: 'sd-target-eq' }, el('span', { class: 'sd-target-op', 'aria-hidden': 'true' }, '='), el('span', { class: 'sd-target-part' }, capacityOut, el('span', {}, 'of patient care'))),
        ),
        el('div', { class: 'sd-target-total' }, icon('target', 22), slotsOut, rateOut),
      ),
      el('div', { class: 'sd-ramp' }, el('label', { class: 'sd-switch' }, ramping, el('i', { 'aria-hidden': 'true' }), el('span', {}, 'Ramping')), el('span', { class: 'sd-field-hint' }, 'Turn this on while a new person builds up to a whole week. Their slots are counted and are not held to the target.')),
    ),
    helpers.length > 0 ? el('p', { class: 'sd-field-hint sd-ww-of' }, icon('person', 16), el('span', {}, `Support staff who work with ${person.name}: ${helpers.join(', ')}. That list is kept on each of them.`)) : null,
    workBlock(s, person),
    el('div', { class: 'sd-person-foot' }, el('span', { class: 'sd-field-hint' }, blocks === 0 ? 'Nothing is scheduled on this week yet.' : `${plural(blocks, 'block')} scheduled on this week.`), el('div', { class: 'sd-action-row' }, remove, copy, design)),
  );
}

export function drawPeople(s: Schedule): HTMLElement {
  const current = personOf(s, app.setupPersonId) ?? s.people[0];
  // A question about one person does not follow the page to another.
  if (asking && asking.personId !== current?.id) asking = null;
  const list = s.people.map((person) => {
    const on = person.id === current?.id;
    const button = el(
      'button',
      { type: 'button', class: 'sd-who', 'data-k': `who:${person.id}`, 'aria-pressed': on ? 'true' : 'false' },
      el('span', { class: 'sd-who-say' }, el('strong', {}, person.name), el('span', {}, person.role || s.departments.find((dept) => dept.id === person.departmentId)?.name || '')),
      el('span', { class: 'sd-who-num' }, whoNum(s, person)),
    );
    if (on) {
      onLive(() => {
        const now = app.schedule;
        const same = now ? personOf(now, person.id) : undefined;
        if (!now || !same) return;
        const name = button.querySelector('strong');
        const role = button.querySelector('.sd-who-say span');
        const hours = button.querySelector('.sd-who-num');
        if (name) name.textContent = same.name;
        if (role) role.textContent = same.role || now.departments.find((dept) => dept.id === same.departmentId)?.name || '';
        if (hours) hours.textContent = whoNum(now, same);
      });
    }
    button.addEventListener('click', () => {
      app.setupPersonId = person.id;
      emit('look');
    });
    return el('li', {}, button);
  });
  const add = addButton('Add a person', 'p-add', () => {
    const next = addPerson(cur());
    const added = next.people.at(-1);
    if (added && next !== s) {
      app.setupPersonId = added.id;
      focusNext('p-name');
    }
    commit(next);
  }, s.people.length >= LIMITS.people || s.departments.length === 0);
  return el(
    'div',
    { class: 'sd-people' },
    el('div', { class: 'sd-people-list' }, el('p', { class: 'sd-people-h' }, plural(s.people.length, 'person', 'people'), el('span', {}, 'Target')), list.length > 0 ? el('ul', {}, ...list) : null, add),
    current
      ? detail(s, current)
      : el('div', { class: 'sd-panel sd-empty' }, el('span', { class: 'cc-badge' }, icon('person', 22)), el('p', {}, s.departments.length === 0 ? 'Add a department in Kinds of time first. Every person belongs to one.' : 'Nobody is in the schedule yet. Add the first person to start their week.')),
  );
}
