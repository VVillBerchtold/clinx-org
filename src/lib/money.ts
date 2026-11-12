/**
 * Money is never a floating-point number in this site.
 * An amount is a whole number of cents (`Cents`), or a decimal string.
 * Percentages are whole numbers of millionths ("micro"): 0.233039 is 233039.
 */

export type Cents = number;
export type Micro = number;

const AMOUNT = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

function checked(value: number, text: string): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`Amount out of range: "${text}"`);
  return value;
}

/**
 * Reads an amount as printed on a filing ("1,408,968.83", "250279.19", "(12.50)", "-")
 * into whole cents. A lone dash is zero. `N/A`, `N/R` and an empty cell are `null`.
 * Anything else throws: a figure is never guessed.
 */
export function parseCents(text: string): Cents | null {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.toUpperCase() === 'N/A' || trimmed.toUpperCase() === 'N/R') return null;
  if (trimmed === '-') return 0;

  let body = trimmed.replace(/^\$/, '');
  let negative = false;
  if (/^\(.*\)$/.test(body)) {
    negative = true;
    body = body.slice(1, -1).trim();
  }
  if (body.startsWith('-')) {
    negative = !negative;
    body = body.slice(1);
  }
  body = body.replace(/^\$/, '');

  const match = AMOUNT.exec(body);
  if (!match) throw new RangeError(`Not an amount: "${text}"`);
  const whole = Number(match[1]!.replaceAll(',', ''));
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const cents = checked(whole * 100 + fraction, text);
  return negative && cents !== 0 ? -cents : cents;
}

/** Sum of whole cents. Exact for any realistic total. */
export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += v;
  return checked(total, String(total));
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `4782768611` -> `$47,827,686.11`. Negative: `-$1.00`. */
export function formatUsd(cents: Cents): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}$${groupThousands(String(dollars))}.${rest}`;
}

/**
 * `4782768611` -> `$47.8 million`, rounded half up to a tenth of a million.
 * Below $1 million the exact amount is returned instead.
 */
export function formatUsdMillions(cents: Cents): string {
  const abs = BigInt(Math.abs(cents));
  if (abs < 100_000_000n) return formatUsd(cents);
  const tenths = (abs + 5_000_000n) / 10_000_000n;
  const text = `${tenths / 10n}.${tenths % 10n}`;
  return `${cents < 0 ? '-' : ''}$${text} million`;
}

/**
 * A rounded amount in two parts, for a figure set large with its unit set small beside it:
 * `127624378100` -> `$1.28` and `billion`; `12384047400` -> `$123.8` and `million`. Rounded half up.
 * Below $1 million the exact amount is returned and the unit is blank.
 */
export function usdRounded(cents: Cents): { figure: string; unit: string } {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError(`Not an amount this can round: ${cents}`);
  const abs = BigInt(cents);
  if (abs < 100_000_000n) return { figure: formatUsd(cents), unit: '' };
  // Tenths of a million; an amount that rounds up to 1,000.0 million is written in billions.
  const tenths = (abs + 5_000_000n) / 10_000_000n;
  if (tenths < 10_000n) return { figure: `$${tenths / 10n}.${tenths % 10n}`, unit: 'million' };
  const hundredths = (abs + 500_000_000n) / 1_000_000_000n;
  return { figure: `$${groupThousands(String(hundredths / 100n))}.${String(hundredths % 100n).padStart(2, '0')}`, unit: 'billion' };
}

/**
 * Reads a decimal fraction written as text ("0.233039") into millionths.
 * More than six decimals is refused rather than rounded.
 */
export function parseMicro(text: string): Micro | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(trimmed);
  if (!match) throw new RangeError(`Not a fraction with up to six decimals: "${text}"`);
  return checked(Number(match[1]) * 1_000_000 + Number((match[2] ?? '').padEnd(6, '0')), text);
}

/** Millionths to a percentage with the given number of decimals, rounded half up. `233039` -> `23.3%`. */
export function formatPercentMicro(micro: Micro, decimals = 1): string {
  if (decimals < 0 || decimals > 4) throw new RangeError('decimals must be 0 to 4');
  const step = BigInt(10 ** (4 - decimals)); // micro units per last shown digit
  const units = (BigInt(micro) + step / 2n) / step;
  const scale = BigInt(10 ** decimals);
  const whole = units / scale;
  const frac = units % scale;
  return decimals === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(decimals, '0')}%`;
}

/** numerator / denominator in millionths, rounded half up. Null when the denominator is not above zero. */
export function ratioMicro(numerator: Cents, denominator: Cents): Micro | null {
  if (denominator <= 0) return null;
  const n = BigInt(numerator) * 1_000_000n;
  const d = BigInt(denominator);
  return Number((n + d / 2n) / d);
}

/**
 * A filed figure as a page draws it. The figure itself is not changed: thousands separators are
 * added ("982072" is drawn "982,072"), and an amount of money typed with one decimal gets its
 * second ("48110.4" is drawn "48,110.40"). Text that is not one plain number (a blank, a word, a
 * code that starts with a zero) is returned exactly as filed.
 */
export function drawFigure(text: string, kind: 'money' | 'count' = 'count'): string {
  const m = /^(-?\$?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$/.exec(text.trim());
  if (!m) return text;
  const digits = m[2]!.replace(/,/g, '');
  if (digits.length > 1 && digits.startsWith('0')) return text;
  let rest = m[3] ?? '';
  if (kind === 'money' && rest.length === 2) rest += '0';
  return `${m[1]}${groupThousands(digits)}${rest}`;
}

/**
 * Bare figures inside a sentence of the dataset's own notes, drawn the same way: "prints 441658
 * claims" becomes "prints 441,658 claims". Years, line numbers and codes are left alone.
 */
export function drawFiguresInText(text: string): string {
  return text
    .replace(/(?<![\w.,#/-])\d{5,}(?:\.\d+)?(?![\w/-]|,\d|\.\d)/g, (figure) => drawFigure(figure))
    .replace(/\b(prints|total of) (\d{4})(?![\d,.]\d|\w)/g, (_all, lead: string, figure: string) => `${lead} ${drawFigure(figure)}`);
}

/** "14485262.63" -> "14,485,262.63". Text that is not a plain number is returned unchanged. */
export function groupDigits(text: string | null): string {
  if (text === null) return '';
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(text.trim());
  if (!m) return text;
  return `${m[1]}${m[2]!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${m[3] ?? ''}`;
}
