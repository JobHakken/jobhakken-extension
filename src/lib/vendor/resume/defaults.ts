/**
 * VENDORED from @jobhakken/core (libraries/core/src/resume/defaults.ts), 2026-08-28 — see
 * src/lib/vendor/llm/types.ts for why core is not a runtime dependency here.
 * KEEP IN SYNC MANUALLY if the desktop/site résumé engine changes upstream.
 */
import { defaultResumeData } from './schema';
import type { Resume } from './model';

/**
 * Starter résumé — the content of resume-template.tex (placeholders intact) as a
 * Reactive Resume v5 `ResumeData`. Used as the default document in Résumé Studio
 * before the user edits or imports their real résumé. Descriptions are rich-text
 * HTML (bullet lists), matching how the editor + templates handle them.
 */

let _uid = 0;
const uid = (): string => `starter-${(_uid += 1)}`;

const noWebsite = { url: '', label: '', inlineLink: false };

/** Wrap plain bullet strings as the rich-text HTML the templates render. */
function bullets(lines: string[]): string {
  return `<ul>${lines.map((l) => `<li><p>${escHtml(l)}</p></li>`).join('')}</ul>`;
}
/** Wrap a plain paragraph string as rich-text HTML. */
function para(text: string): string {
  return `<p>${escHtml(text)}</p>`;
}
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const STARTER_RESUME: Resume = {
  ...defaultResumeData,
  basics: {
    ...defaultResumeData.basics,
    name: 'Your Name',
    headline: 'Your Job Title',
    email: 'your.email@example.com',
    phone: '+1 (555) 000-0000',
    location: 'City, State',
    website: { url: '', label: '' },
    customFields: [
      { id: uid(), icon: 'linkedin-logo', text: 'linkedin.com/in/your-profile', link: '' },
      { id: uid(), icon: 'github-logo', text: 'github.com/your-username', link: '' },
    ],
  },
  summary: {
    ...defaultResumeData.summary,
    content: para(
      'Write 2–3 sentences about yourself: your current role, years of experience, your strongest skills, and the kind of role you’re looking for. Keep it concise and tailor it to the jobs you apply to.',
    ),
  },
  sections: {
    ...defaultResumeData.sections,
    education: {
      ...defaultResumeData.sections.education,
      items: [
        {
          id: uid(),
          hidden: false,
          school: 'School or University Name',
          degree: 'Your Degree (e.g. B.S. in Your Field)',
          area: '',
          grade: '',
          location: '',
          period: 'Month YYYY – Month YYYY',
          website: noWebsite,
          description: '',
        },
      ],
    },
    skills: {
      ...defaultResumeData.sections.skills,
      items: [
        skill('Skills', ['Add a skill', 'Add a skill', 'Add a skill', 'Add a skill']),
        skill('Tools', ['Add a tool', 'Add a tool', 'Add a tool']),
      ],
    },
    experience: {
      ...defaultResumeData.sections.experience,
      items: [
        experience('Your Job Title', 'Company Name', 'Month YYYY – Present', [
          'Describe a key responsibility or achievement — start with an action verb (Led, Built, Improved) and add a measurable result.',
          'Add another bullet that highlights your impact, scope, or a metric.',
        ]),
        experience('Previous Job Title', 'Company Name', 'Month YYYY – Month YYYY', [
          'Summarize what you did in this role and the results you delivered.',
          'Add a specific, quantified achievement (e.g. “Increased X by Y%”).',
        ]),
      ],
    },
    projects: {
      ...defaultResumeData.sections.projects,
      items: [
        project('Project Name', 'Personal or Company', 'Month YYYY – Month YYYY', [
          'Briefly describe the project: your role, the tools or technologies you used, and the outcome.',
        ]),
      ],
    },
  },
  metadata: {
    ...defaultResumeData.metadata,
    layout: {
      ...defaultResumeData.metadata.layout,
      // single-column for the .tex-faithful HTML templates; summary → education → skills → …
      pages: [{ fullWidth: true, main: ['summary', 'education', 'skills', 'experience', 'projects'], sidebar: [] }],
    },
  },
};

function skill(name: string, keywords: string[]) {
  return { id: uid(), hidden: false, icon: '', iconColor: '', name, proficiency: '', level: 0, keywords };
}

function experience(position: string, company: string, period: string, lines: string[]) {
  return {
    id: uid(),
    hidden: false,
    company,
    position,
    location: '',
    period,
    website: noWebsite,
    description: bullets(lines),
    roles: [],
  };
}

function project(name: string, affiliation: string, period: string, lines: string[]) {
  return {
    id: uid(),
    hidden: false,
    name,
    period: `${affiliation} · ${period}`,
    website: noWebsite,
    description: bullets(lines),
  };
}
