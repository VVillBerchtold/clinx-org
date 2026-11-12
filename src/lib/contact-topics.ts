/**
 * The subjects a visitor can choose on the contact form. One list, used by the page and by the
 * small program that sends the message, so the two can never disagree.
 */
export const CONTACT_TOPICS = [
  { value: 'question', label: 'A question' },
  { value: 'correction', label: 'A correction to a figure' },
  { value: 'feedback', label: 'Feedback on the site' },
  { value: 'request', label: 'A request for a tool or dataset' },
  { value: 'press', label: 'Press' },
  { value: 'other', label: 'Something else' },
] as const;

export type ContactTopic = (typeof CONTACT_TOPICS)[number]['value'];

/** The longest value each field may hold. The page's inputs carry the same numbers. */
export const CONTACT_LIMITS = { name: 120, email: 320, organization: 200, message: 4000 } as const;
