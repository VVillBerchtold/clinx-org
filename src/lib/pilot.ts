/**
 * The facts the rebate pilot page needs that are not in the notices table: the drugs on the list
 * the notice points to, and the claim fields the notice allows a drug maker to ask for.
 *
 * In plain words: the 340B Rebate Model Pilot Program was opened by one notice in the Federal
 * Register (91 FR 48883, document 2026-15633). That notice says which drugs the pilot covers by
 * pointing to a list kept by the Centers for Medicare & Medicaid Services, and it prints a table of
 * the claim fields a plan may ask for. Both are copied here by hand, exactly as printed, so the
 * page can show them. If the notice or the list changes, this file is where to change them; the
 * dates on the page come from the notices table and need no change here.
 */

/** The address of the page. */
export const PILOT_HOME = '/rebate-pilot/';

/** The list the notice names (its footnote 41) and the version of it copied below. */
export const DRUG_LIST = {
  name: 'Medicare Drug Price Negotiation Selected Drug List',
  /** The day printed on the list ("Version: 01/17/2025"). */
  version: '2025-01-17',
  url: 'https://www.cms.gov/files/zip/medicare-drug-price-negotiation-selected-drug-list.zip',
  program: 'https://www.cms.gov/priorities/medicare-prescription-drug-affordability/overview/medicare-drug-price-negotiation-program',
} as const;

export interface SelectedDrug {
  /** The brand names, as the list groups them. */
  name: string;
  /** The active ingredient, as the list names it. */
  ingredient: string;
}

/** The selected drugs by the first year their negotiated price applies, A to Z, as the list groups them. */
export const SELECTED_DRUGS: readonly { year: number; drugs: readonly SelectedDrug[] }[] = [
  {
    year: 2026,
    drugs: [
      { name: 'Eliquis', ingredient: 'apixaban' },
      { name: 'Enbrel', ingredient: 'etanercept' },
      { name: 'Entresto', ingredient: 'valsartan / sacubitrilat' },
      { name: 'Farxiga', ingredient: 'dapagliflozin' },
      { name: 'Imbruvica', ingredient: 'ibrutinib' },
      { name: 'Januvia', ingredient: 'sitagliptin' },
      { name: 'Jardiance', ingredient: 'empagliflozin' },
      { name: 'NovoLog, NovoLog FlexPen, NovoLog PenFill, Fiasp, Fiasp FlexTouch, Fiasp PenFill', ingredient: 'insulin aspart, human' },
      { name: 'Stelara', ingredient: 'ustekinumab' },
      { name: 'Xarelto', ingredient: 'rivaroxaban' },
    ],
  },
  {
    year: 2027,
    drugs: [
      { name: 'Austedo, Austedo XR', ingredient: 'deutetrabenazine' },
      { name: 'Breo Ellipta', ingredient: 'fluticasone; vilanterol' },
      { name: 'Calquence', ingredient: 'acalabrutinib' },
      { name: 'Ibrance', ingredient: 'palbociclib' },
      { name: 'Janumet, Janumet XR', ingredient: 'metformin; sitagliptin' },
      { name: 'Linzess', ingredient: 'linaclotide' },
      { name: 'Ofev', ingredient: 'nintedanib' },
      { name: 'Otezla', ingredient: 'apremilast' },
      { name: 'Ozempic, Rybelsus, Wegovy', ingredient: 'semaglutide' },
      { name: 'Pomalyst', ingredient: 'pomalidomide' },
      { name: 'Tradjenta', ingredient: 'linagliptin' },
      { name: 'Trelegy Ellipta', ingredient: 'fluticasone; umeclidinium; vilanterol' },
      { name: 'Vraylar', ingredient: 'cariprazine' },
      { name: 'Xifaxan', ingredient: 'rifaximin' },
      { name: 'Xtandi', ingredient: 'enzalutamide' },
    ],
  },
];

/** The claim fields a plan may ask a covered entity for, as the notice's table prints them. */
export const CLAIM_FIELDS = {
  pharmacy: ['Date of Service', 'Date Prescribed', 'Rx number', 'Fill number', 'NDC-11', 'Quantity Dispensed', 'Prescriber ID', 'Service Provider ID', '340B ID', 'RX BIN', 'RX PCN'],
  medical: [
    'Date of Service',
    'Claim Line Number',
    'Claim Number',
    'Unit of Measure',
    'NDC-11',
    'Quantity',
    'Rendering Physician ID',
    'Service Provider ID',
    '340B ID',
    'Health Plan Name',
    'Health Plan ID',
    'Health Plan ID Qualifier (if available)',
  ],
} as const;

/** Where the agency says it posts approved plans and its findings. This site cannot read that page for you. */
export const HRSA_340B = 'https://www.hrsa.gov/opa';
