/**
 * The contact form works with scripts off. With them on, this adds three small things:
 * how long the form was open (a spam signal the server reads), a character count under the
 * message, and a Back button on the "not sent" page that returns to what was typed.
 * Nothing here opens a connection; the form itself is an ordinary post to this site.
 */
const form = document.querySelector<HTMLFormElement>('[data-contact-form]');
if (form) {
  const openedAt = Date.now();
  const openMs = form.querySelector<HTMLInputElement>('[data-open-ms]');
  form.addEventListener('submit', () => {
    if (openMs) openMs.value = String(Date.now() - openedAt);
  });

  const message = form.querySelector<HTMLTextAreaElement>('textarea[name="message"]');
  const count = form.querySelector<HTMLElement>('[data-count]');
  const now = form.querySelector<HTMLElement>('[data-count-now]');
  if (message && count && now) {
    const show = () => {
      now.textContent = message.value.length.toLocaleString('en-US');
      count.classList.toggle('near', message.value.length > message.maxLength * 0.9);
    };
    count.hidden = false;
    message.addEventListener('input', show);
    show();
  }
}

const back = document.querySelector<HTMLAnchorElement>('[data-back]');
if (back && history.length > 1) {
  back.addEventListener('click', (event) => {
    event.preventDefault();
    history.back();
  });
}
