// Set up, the Kinds of time tab: each department with its visit types, and the other kinds of
// time such as meetings and lunch.
import { LIMITS, addActivity, addDepartment, addVisitType, departmentOf, removeActivity, removeDepartment, removeVisitType, renameDepartment, setActivity, setDepartmentStandards, setDepartmentStep, setVisitType, visitTypeOf } from './engine/index';
import type { Schedule, Step } from './engine/index';
import { el, icon, plural, segmented } from './dom';
import { app, commit } from './state';
import { addButton, change, cur, focusNext, numberBox, onLive, removeButton, swatchPicker, textBox } from './setup-parts';
import { hourNum, hourSpan, percent, slotNum } from './slots';

function department(s: Schedule, id: string): HTMLElement | null {
  const dept = s.departments.find((item) => item.id === id);
  if (!dept) return null;
  const people = s.people.filter((person) => person.departmentId === dept.id).length;
  const rows = dept.visitTypes.map((type) =>
    el(
      'li',
      { class: 'sd-kind' },
      swatchPicker(`vt-c:${type.id}`, type.name, type.colour, (colour) => commit(setVisitType(cur(), type.id, { colour }).schedule)),
      textBox({ label: `Name of the visit type ${type.name}`, key: `vt-n:${type.id}`, value: type.name, extra: 'sd-kind-name', set: (now, value) => setVisitType(now, type.id, { name: value }).schedule, read: (now) => visitTypeOf(now, type.id)?.name ?? '' }),
      textBox({ label: `Short code for ${type.name}`, key: `vt-k:${type.id}`, value: type.code, extra: 'sd-kind-code', max: LIMITS.code, placeholder: 'Code', set: (now, value) => setVisitType(now, type.id, { code: value }).schedule, read: (now) => visitTypeOf(now, type.id)?.code ?? '' }),
      el(
        'span',
        { class: 'sd-kind-len' },
        numberBox({
          label: `Minutes for ${type.name}`,
          key: `vt-m:${type.id}`,
          value: type.minutes,
          least: LIMITS.visitMinutes.least,
          most: LIMITS.visitMinutes.most,
          step: 5,
          set: (now, value) => setVisitType(now, type.id, { minutes: value }),
          read: (now) => visitTypeOf(now, type.id)?.minutes ?? type.minutes,
          took: (appointments) => `${appointments} of ${type.name} were laid out again at the new length.`,
        }),
        el('span', { 'aria-hidden': 'true' }, 'min'),
      ),
      removeButton(`Remove ${type.name}`, `vt-x:${type.id}`, () => {
        focusNext(`vt-add:${dept.id}`);
        change(removeVisitType(cur(), type.id), `Removed ${type.name}.`, (appointments) => `${appointments} of that type went with it.`, 'appointment');
      }),
    ),
  );
  // One line under the standards that says what they mean, kept up to date as the person types.
  const standards = el('p', { class: 'sd-standards-say', role: 'status' });
  const say = (factor: number | undefined, slots: number | undefined): void => {
    const now = departmentOf(app.schedule ?? s, dept.id) ?? dept;
    const careFactor = Math.min(LIMITS.careFactor.most, Math.max(LIMITS.careFactor.least, factor ?? now.careFactor));
    const slotsPerHour = Math.min(LIMITS.slotsPerHour.most, Math.max(LIMITS.slotsPerHour.least, slots ?? now.slotsPerHour));
    const who = people === 0 ? 'Nobody is in this department yet.' : `${plural(people, 'person', 'people')} in this department.`;
    standards.textContent = `${percent(careFactor)} of contract hours is patient care, and a slot is ${Number.isInteger(60 / slotsPerHour) ? hourSpan(1 / slotsPerHour) : `${hourNum(60 / slotsPerHour)} min`}. A 40 h contract with nothing set aside has a target of ${slotNum(Math.round(40 * careFactor * slotsPerHour))} slots. ${who}`;
  };
  say(undefined, undefined);
  onLive(() => say(undefined, undefined));
  return el(
    'section',
    { class: 'sd-panel sd-dept' },
    el(
      'div',
      { class: 'sd-panel-head' },
      el('span', { class: 'cc-badge' }, icon('sheet', 20)),
      textBox({ label: 'Department name', key: `dept:${dept.id}`, value: dept.name, extra: 'is-title', set: (now, value) => renameDepartment(now, dept.id, value), read: (now) => now.departments.find((item) => item.id === dept.id)?.name ?? '' }),
      removeButton(`Remove ${dept.name}`, `dept-x:${dept.id}`, () => {
        focusNext('dept-add');
        change(removeDepartment(cur(), dept.id), `Removed ${dept.name}.`, (appointments) => `${appointments} of its visit types went with it.`, 'appointment');
      }),
    ),
    el(
      'div',
      { class: 'sd-standards' },
      el(
        'label',
        { class: 'sd-field' },
        el('span', { class: 'sd-field-label' }, 'Clinical factor'),
        el(
          'span',
          { class: 'sd-kind-len' },
          numberBox({
            label: `Clinical factor for ${dept.name}, as a percent`,
            key: `dept-f:${dept.id}`,
            value: Math.round(dept.careFactor * 1000) / 10,
            least: LIMITS.careFactor.least * 100,
            most: LIMITS.careFactor.most * 100,
            step: 1,
            set: (now, value) => setDepartmentStandards(now, dept.id, { careFactor: value / 100 }),
            read: (now) => Math.round((departmentOf(now, dept.id)?.careFactor ?? dept.careFactor) * 1000) / 10,
            typing: (value) => say(value / 100, undefined),
          }),
          el('span', { 'aria-hidden': 'true' }, '%'),
        ),
      ),
      el(
        'label',
        { class: 'sd-field' },
        el('span', { class: 'sd-field-label' }, 'Slots an hour'),
        el(
          'span',
          { class: 'sd-kind-len' },
          numberBox({
            label: `Slots an hour for ${dept.name}`,
            key: `dept-s:${dept.id}`,
            value: dept.slotsPerHour,
            least: LIMITS.slotsPerHour.least,
            most: LIMITS.slotsPerHour.most,
            step: 0.5,
            set: (now, value) => setDepartmentStandards(now, dept.id, { slotsPerHour: value }),
            read: (now) => departmentOf(now, dept.id)?.slotsPerHour ?? dept.slotsPerHour,
            typing: (value) => say(undefined, value),
          }),
          el('span', { 'aria-hidden': 'true' }, 'slots'),
        ),
      ),
      el(
        'div',
        { class: 'sd-field' },
        el('span', { class: 'sd-field-label' }, 'Grid for new people'),
        segmented<Step>(
          `Grid for new people in ${dept.name}`,
          [
            { value: 15, say: '15 min' },
            { value: 20, say: '20 min' },
          ],
          dept.step,
          (step) => commit(setDepartmentStep(cur(), dept.id, step)),
        ),
      ),
      standards,
    ),
    rows.length > 0 ? el('div', { class: 'sd-kind-head', 'aria-hidden': 'true' }, el('span', {}), el('span', {}, 'Visit type'), el('span', {}, 'Code'), el('span', {}, 'Length'), el('span', {})) : null,
    el('ul', { class: 'sd-kinds' }, ...rows),
    addButton('Add a visit type', `vt-add:${dept.id}`, () => {
      const next = addVisitType(cur(), dept.id);
      const added = next.departments.find((item) => item.id === dept.id)?.visitTypes.at(-1);
      if (added && next !== s) focusNext(`vt-n:${added.id}`);
      commit(next);
    }, dept.visitTypes.length >= LIMITS.visitTypesPerDepartment),
  );
}

function otherTime(s: Schedule): HTMLElement {
  const rows = s.activities.map((activity) => {
    const paid = el('input', { type: 'checkbox', 'data-k': `act-p:${activity.id}`, checked: activity.paid });
    paid.checked = activity.paid;
    paid.addEventListener('change', () => commit(setActivity(cur(), activity.id, { paid: paid.checked })));
    return el(
      'li',
      { class: 'sd-kind is-other' },
      swatchPicker(`act-c:${activity.id}`, activity.name, activity.colour, (colour) => commit(setActivity(cur(), activity.id, { colour }))),
      textBox({ label: `Name of ${activity.name}`, key: `act-n:${activity.id}`, value: activity.name, extra: 'sd-kind-name', set: (now, value) => setActivity(now, activity.id, { name: value }), read: (now) => now.activities.find((item) => item.id === activity.id)?.name ?? '' }),
      el('label', { class: 'sd-switch' }, paid, el('i', { 'aria-hidden': 'true' }), el('span', {}, 'Paid time')),
      removeButton(`Remove ${activity.name}`, `act-x:${activity.id}`, () => {
        focusNext('act-add');
        change(removeActivity(cur(), activity.id), `Removed ${activity.name}.`, (blocks) => `${blocks} of it went with it.`);
      }),
    );
  });
  return el(
    'section',
    { class: 'sd-panel sd-dept' },
    el('div', { class: 'sd-panel-head' }, el('span', { class: 'cc-badge' }, icon('clock', 20)), el('h3', { class: 'sd-panel-title' }, 'Other time')),
    el('p', { class: 'sd-panel-say' }, 'Time that is not with patients. Paid time counts toward contract hours. Unpaid time, such as lunch, does not.'),
    el('ul', { class: 'sd-kinds' }, ...rows),
    addButton('Add a kind of time', 'act-add', () => {
      const next = addActivity(cur());
      const added = next.activities.at(-1);
      if (added && next !== s) focusNext(`act-n:${added.id}`);
      commit(next);
    }, s.activities.length >= LIMITS.activities),
  );
}

export function drawKinds(s: Schedule): HTMLElement {
  return el(
    'div',
    { class: 'sd-form' },
    ...s.departments.map((dept) => department(s, dept.id)),
    addButton('Add a department', 'dept-add', () => {
      const next = addDepartment(cur());
      const added = next.departments.at(-1);
      if (added && next !== s) focusNext(`dept:${added.id}`);
      commit(next);
    }, s.departments.length >= LIMITS.departments),
    otherTime(s),
  );
}
