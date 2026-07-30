import type { FullProfile } from '@jobhakken/autofill';

/**
 * A built-in, fully anonymous profile for TEST MODE. When test mode is on the extension
 * autofills from this instead of your real profile / connected desktop app — so you can
 * exercise autofill on real application pages without any risk of typing your real
 * identity into a live form. Placeholder identity only (Jordan Rivera / example.com).
 */
export const TEST_PROFILE: FullProfile = {
  profile: {
    prefix: 'Mx.',
    firstName: 'Jordan',
    middleName: 'Alex',
    lastName: 'Rivera',
    fullName: 'Jordan Alex Rivera',
    preferredName: 'Jordan',
    email: 'jordan.rivera@example.com',
    // A libphonenumber-valid US example ((201) 555-0123 → +12015550123). The old (555) 010-0134 was
    // rejected by real region validators (Workday): 555 is not a valid area code and an exchange
    // starting with 0 is illegal, so the number blocked the wizard's Save-and-Continue.
    phone: '(201) 555-0123',
    nationality: 'United States',
    addressLine1: '128 Maple Street',
    addressLine2: 'Apt 4B',
    city: 'Austin',
    county: 'Travis County',
    state: 'TX',
    zipCode: '78701',
    country: 'United States',
    location: 'Austin, TX',
    linkedin: 'https://www.linkedin.com/in/jordan-rivera',
    github: 'https://github.com/jordan-rivera',
    website: 'https://jordanrivera.dev',
    currentCompany: 'Globex Corp',
    currentTitle: 'Senior Engineer',
    yearsExperience: '6',
    startDate: '2025-09',
    noticePeriod: '2 weeks',
    willingToRelocate: 'Yes',
    // sensitive — placeholder answers (never auto-submitted; you review on the page)
    workAuthorization: 'Yes',
    requiresSponsorship: 'No',
    salaryExpectation: '150,000 USD',
    currentSalary: '135,000 USD',
    gender: 'Prefer not to say',
    pronouns: 'they/them',
    raceEthnicity: 'Prefer not to say',
    hispanicLatino: 'No',
    veteranStatus: 'I am not a protected veteran',
    disabilityStatus: 'No, I do not have a disability',
    // A real, searchable institution: Workday's School field is a prompt backed by a real
    // institution database, so a generic "State University" never matches. Real ATS use needs the
    // user's actual school; the dummy profile uses a real name so demo/tests exercise the match.
    school: 'The University of Texas at Austin',
    degree: 'Masters',
    fieldOfStudy: 'Computer Science',
  },
  experience: [
    {
      company: 'Globex Corp',
      position: 'Senior Engineer',
      period: 'Jun 2021 – Present',
      highlights: [
        'Led the migration to a microservices architecture, cutting p95 latency by 40%.',
        'Mentored five engineers and owned the on-call rotation.',
      ],
    },
    {
      company: 'Initech',
      position: 'Software Engineer',
      period: 'Jan 2019 - May 2021',
      highlights: ['Built the billing service that grew to $2M ARR.'],
    },
    {
      company: 'Umbrella Systems',
      position: 'Junior Engineer',
      period: 'Jun 2017 - Dec 2018',
      highlights: ['Automated the release pipeline, cutting deploy time in half.'],
    },
  ],
  education: [
    {
      school: 'The University of Texas at Austin',
      degree: 'Masters',
      fieldOfStudy: 'Computer Science',
      period: '2022 - 2024',
    },
    {
      school: 'Texas State University',
      degree: 'Bachelors',
      fieldOfStudy: 'Electrical Engineering',
      period: '2016 - 2020',
    },
    { school: 'Riverdale High', degree: 'High School Diploma', fieldOfStudy: 'General', period: '2012 - 2016' },
  ],
  rules: [{ condition: '(how did you hear)', value: 'LinkedIn' }],
};
