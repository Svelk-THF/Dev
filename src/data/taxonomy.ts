// Single source of truth for the filter categories.
// Add a new sector or beneficiary here and it automatically becomes:
//  - a valid value in the content schema (typos in Markdown fail the build)
//  - a filter checkbox on the home page
//  - a readable label on cards and detail pages

export const SECTORS = {
  health: 'Health & Disability',
  social_services: 'Social services & housing',
  community: 'Community', 
  education: 'Eduction & training', 
  arts_culture: 'Arts, culture & heritage',
  sport: 'Sport & Recreation',
  environment: 'Environment & animal welfare',
  faith: 'Faith',
  other: 'Other',
} as const;

export const BENEFICIARIES = {
  animals: 'Animals',
  youth: 'Children & young people',
  family: 'Family',
  general: 'General public',
  race: 'Specific ethnicities',
  older: 'Older people',
  disabilities: 'People with disabilities',
  other: 'Other',
} as const;

export type Sector = keyof typeof SECTORS;
export type Beneficiaries = keyof typeof BENEFICIARIES;

export const sectorKeys = Object.keys(SECTORS) as [Sector, ...Sector[]];
export const beneficiariesKeys = Object.keys(BENEFICIARIES) as [Beneficiaries, ...Beneficiaries[]];
