// Makes a stand-in for a value: random, but of the same kind and shape.
//
// In plain words: "Marisol Reyes" becomes something like "Nufoxid Tarow", "401-555-0142" becomes
// another number in the same pattern, and 14 March 1962 becomes another real date. A vowel gets a
// vowel and a consonant a consonant, so a stand-in can be read aloud. The same
// original always gets the same stand-in during one run, so a patient ID that appears on two
// sheets still matches on both, and a lookup between them still works. Nothing here is kept after
// the page is closed, and there is no key that could turn a stand-in back into the original.

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const VOWELS = 'aeiou';
const CONSONANTS = 'bcdfghjklmnpqrstvwxyz';
/** True for a, e, i, o, u, with or without an accent. */
const isVowel = (ch) => VOWELS.includes(ch.normalize('NFD')[0].toLowerCase());

/** Whole numbers from the computer's own source of randomness, a batch at a time. */
function randomSource() {
  const pool = new Uint32Array(4096);
  let next = pool.length;
  return (below) => {
    if (next === pool.length) {
      crypto.getRandomValues(pool);
      next = 0;
    }
    return pool[next++] % below;
  };
}

const pad = (number, width) => String(number).padStart(width, '0');

export function makeFaker() {
  const random = randomSource();
  const texts = new Map();
  const numbers = new Map();
  const dates = new Map();
  const taken = new Set();
  // Real values known before any stand-in is made, so that no stand-in equals one of them by chance.
  const real = new Set();
  let dateRange = [36526, 46022]; // 1 Jan 2000 to 31 Dec 2025 as workbook day numbers, until told otherwise

  const digits = (count, firstNotZero) => {
    let out = '';
    for (let i = 0; i < count; i++) out += i === 0 && firstNotZero && count > 1 ? 1 + random(9) : random(10);
    return out;
  };

  /**
   * Same letters-for-letters, digits-for-digits pattern; every other character is left where it was.
   * A vowel gets a vowel and a consonant a consonant, unless `anyLetter` is asked for.
   */
  function sameShape(value, anyLetter = false) {
    const letter = (ch) => (anyLetter ? LOWER[random(26)] : isVowel(ch) ? VOWELS[random(5)] : CONSONANTS[random(21)]);
    let out = '';
    // An ID or a ZIP code written with zeros in front keeps exactly that many zeros in front.
    const zeros = /^\d+$/.test(value) ? /^0*/.exec(value)[0].length : -1;
    for (const ch of value) {
      if (zeros >= 0 && out.length < zeros) out += '0';
      else if (zeros >= 0 && out.length === zeros) out += 1 + random(9);
      else if (ch >= '0' && ch <= '9') out += random(10);
      else if (ch >= 'A' && ch <= 'Z') out += letter(ch).toUpperCase();
      else if (ch >= 'a' && ch <= 'z') out += letter(ch);
      else if (ch.toLowerCase() !== ch.toUpperCase()) out += ch === ch.toUpperCase() ? letter(ch).toUpperCase() : letter(ch);
      // Writing that has no capitals (Chinese, Arabic, Hebrew and others) and digits other than 0 to 9.
      else if (/\p{L}/u.test(ch)) out += LOWER[random(26)];
      else if (/\p{N}/u.test(ch)) out += random(10);
      else out += ch;
    }
    return out;
  }

  /** A year within nine of the original, never in the future, each as likely as the next. */
  const nearbyYear = (year) => {
    const first = Math.max(1900, year - 9);
    const last = Math.max(first, Math.min(new Date().getFullYear(), year + 9));
    return first + random(last - first + 1);
  };

  /** A date written out as text becomes another real date written the same way. */
  function writtenDate(value) {
    let m = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})$/.exec(value);
    if (m) {
      const year = m[4].length === 4 ? nearbyYear(Number(m[4])) : random(100);
      return `${pad(1 + random(12), m[1].length)}${m[2]}${pad(1 + random(28), m[3].length)}${m[2]}${pad(year, m[4].length)}`;
    }
    m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(value);
    if (m) return `${nearbyYear(Number(m[1]))}-${pad(1 + random(12), 2)}-${pad(1 + random(28), 2)}${m[4]}`;
    return null;
  }

  /**
   * A stand-in no other original has and no real value equals. `wider`, where given, makes one from
   * more choices; it is turned to when the first way keeps landing on values already in use (a
   * one-letter text has only a few stand-ins that can be read aloud).
   */
  function fresh(make, original, wider = make) {
    for (let tries = 0; tries < 60; tries++) {
      const made = tries < 20 ? make() : wider();
      if (made !== original && !taken.has(made) && !real.has(made)) {
        taken.add(made);
        return made;
      }
    }
    // Every stand-in of this shape is in use. One that is at least not the original is given.
    for (let tries = 0; tries < 100; tries++) {
      const made = wider();
      if (made !== original) return made;
    }
    return wider();
  }

  return {
    /** How many different originals have a stand-in so far. */
    get size() {
      return texts.size + numbers.size + dates.size;
    },
    /** The originals seen, for checking afterwards that none is left in the cleaned file. */
    originals: () => [...texts.keys()],
    knows: (value) => texts.has(value),
    /** Real values a stand-in must never equal. */
    avoid(values) {
      for (const value of values) real.add(value);
    },
    /** Every stand-in text made so far. */
    madeUp: () => new Set(texts.values()),
    setDateRange(first, last) {
      if (Number.isFinite(first) && Number.isFinite(last)) dateRange = last - first >= 60 ? [first, last] : [first - 365, last + 365];
    },
    text(value) {
      if (value === '' || /^\s+$/.test(value)) return value;
      let made = texts.get(value);
      if (made === undefined) {
        made = fresh(() => writtenDate(value) ?? sameShape(value), value, () => writtenDate(value) ?? sameShape(value, true));
        texts.set(value, made);
      }
      return made;
    },
    /** A number as it is written in the file. Zero stays zero; the count of digits and decimals is kept. */
    number(written) {
      let made = numbers.get(written);
      if (made !== undefined) return made;
      const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(written);
      if (!m) {
        const value = Number(written);
        made = Number.isFinite(value) ? String(Number((value * (0.5 + random(1000) / 1000)).toPrecision(6))) : written;
      } else if (/^0+$/.test(m[2]) && (m[3] === undefined || /^0+$/.test(m[3]))) {
        made = written;
      } else {
        const whole = m[2].length >= 4;
        made = fresh(() => m[1] + digits(m[2].length, true) + (m[3] === undefined ? '' : '.' + digits(m[3].length, false)), whole ? written : null);
        if (!whole) taken.delete(made); // short numbers (a quantity of 30) may share a stand-in; long ones (an ID) may not
      }
      numbers.set(written, made);
      return made;
    },
    /** A date held as a workbook day number. A time of day, where there is one, is kept as a time of day. */
    date(written) {
      let made = dates.get(written);
      if (made !== undefined) return made;
      const value = Number(written);
      if (!Number.isFinite(value)) return written;
      const day = dateRange[0] + random(Math.max(1, Math.floor(dateRange[1] - dateRange[0]) + 1));
      const part = value - Math.floor(value);
      made = part === 0 ? String(day) : String(day + random(86400) / 86400);
      dates.set(written, made);
      return made;
    },
  };
}
