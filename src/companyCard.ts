// Display helpers for the compact company card on the Companies page.
// They only shape what is shown; stored company data is not changed.
import type { Company, FundingArticle } from './lib/api';

export interface CardFounder {
  name: string;
  title: string;
  /** Profile link when research found one, otherwise a LinkedIn people search for name + company. */
  linkedin: string;
  isSearch: boolean;
}
export interface CardEmail {
  address: string;
  kind: 'CEO' | 'recruiting' | 'company';
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const linkedinSearch = (name: string, company: string) =>
  `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${name} ${company}`)}`;

// A capitalized word in any alphabet ("Engesæth"); names are one to three such words.
const WORD = "\\p{Lu}[\\p{Ll}'’-]+";
const PERSON = `${WORD}(?:\\s+${WORD}){0,2}`;
// "co-founder", "Co-founders", "co-founder and CEO", "Co-founder and Chief Executive Officer", "CEO and co-founder".
const ROLE =
  '(?:(?:[Cc]o-?)?[Ff]ounders?(?:\\s+(?:and|&)\\s+(?:CEO|CTO|COO|CFO|[Pp]resident|[Cc]hief\\s+\\p{Lu}?\\p{Ll}+\\s+[Oo]fficer|[Ee]xecutive\\s+[Cc]hairman|[Cc]hairman))?' +
  '|(?:CEO|[Cc]hief\\s+[Ee]xecutive\\s+[Oo]fficer)\\s+(?:and|&)\\s+(?:[Cc]o-?)?[Ff]ounder)';
const NOT_A_NAME = /^(?:The|This|That|Its|Our|Their|His|Her|Both|Two|Three|Founders?|Co-founders?)$/;

function titleFrom(role: string) {
  const extra = role.match(
    /CEO|CTO|COO|CFO|[Pp]resident|[Cc]hief\s+(\w+)\s+[Oo]fficer|[Ee]xecutive\s+[Cc]hairman|[Cc]hairman/,
  );
  const chief: Record<string, string> = { executive: 'CEO', operating: 'COO', technology: 'CTO', financial: 'CFO' };
  const second = !extra
    ? ''
    : extra[1]
      ? (chief[extra[1].toLowerCase()] ?? `Chief ${extra[1]} Officer`)
      : extra[0].replace(/^\w/, c => c.toUpperCase()).replace(/chairman/i, 'Chairman');
  const first = /co-?founder/i.test(role) ? 'Co-founder' : 'Founder';
  return second ? `${first} & ${second}` : first;
}

/**
 * Founders of this company named in the funding article. A person counts only when the sentence ties them to the
 * company by name ("Finpilot co-founder and CEO …", "…, co-founders of Siggy", "…, Finpilot's co-founder"), so
 * founders of other companies mentioned as investors are not picked up.
 */
export function foundersFromText(text: string, company: string): { name: string; title: string }[] {
  const C = escape(company);
  const own = `${C}['’]s`;
  const flat = text.replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1');
  const patterns: [RegExp, number[], number][] = [
    // "Finpilot co-founder and CEO Lakshay Chauhan"
    [new RegExp(`${C}(?:['’]s)?\\s+(${ROLE})\\s+(${PERSON})`, 'gu'), [2], 1],
    // "Jonathan Sabbagh and Edvard Engesæth, co-founders of Siggy" / "Vivian Qu, Co-founder and Chief Executive Officer of RadianX"
    [
      new RegExp(`(${PERSON})(?:\\s+and\\s+(${PERSON}))?,\\s+(?:the\\s+)?(${ROLE})\\s+(?:of|at)\\s+${C}\\b`, 'gu'),
      [1, 2],
      3,
    ],
    // "Lakshay Chauhan, Finpilot's co-founder and CEO"
    [new RegExp(`(${PERSON}),\\s+${own}\\s+(${ROLE})`, 'gu'), [1], 2],
    // "Alberg is Finpilot's co-founder and executive chairman"
    [new RegExp(`(${PERSON})\\s+is\\s+(?:also\\s+)?${own}\\s+(${ROLE})`, 'gu'), [1], 2],
    // "Siggy was founded by Ana Ruiz and Tom Lee"
    [
      new RegExp(
        `${C}\\s+(?:was\\s+)?((?:co-?)?founded)\\s+(?:in\\s+\\d{4}\\s+)?by\\s+(${PERSON})(?:,?\\s+and\\s+(${PERSON}))?`,
        'gu',
      ),
      [2, 3],
      1,
    ],
    // "Ana Ruiz and Tom Lee founded Siggy"
    [new RegExp(`(${PERSON})(?:\\s+and\\s+(${PERSON}))?\\s+((?:co-?)?founded)\\s+${C}\\b`, 'gu'), [1, 2], 3],
  ];
  const found = new Map<string, string>();
  /** Expand a surname-only mention ("Alberg") to the full name used elsewhere in the article ("John Alberg"). */
  const fullName = (name: string) => {
    if (name.includes(' ')) return name;
    const full = flat.match(new RegExp(`(${WORD})\\s+${escape(name)}\\b`, 'u'));
    return full && !NOT_A_NAME.test(full[1]) ? `${full[1]} ${name}` : null;
  };
  for (const [pattern, nameGroups, roleGroup] of patterns) {
    for (const match of flat.matchAll(pattern)) {
      for (const group of nameGroups) {
        const raw = match[group]?.trim();
        if (!raw || NOT_A_NAME.test(raw.split(' ')[0]) || raw.toLowerCase() === company.toLowerCase()) continue;
        const name = fullName(raw);
        if (!name) continue;
        const title = titleFrom(match[roleGroup]);
        // Keep the most specific title seen for a person.
        if (!found.has(name) || title.length > found.get(name)!.length) found.set(name, title);
      }
    }
  }
  return [...found].map(([name, title]) => ({ name, title }));
}

/** Researched founders first; if none were found, names stated in the funding article. */
export function cardFounders(company: Company, article: FundingArticle): CardFounder[] {
  const researched = (company.founders ?? []).map(f => ({ name: f.name, title: f.title, profile: f.profile_url }));
  const list = researched.length
    ? researched
    : foundersFromText(article.summary, article.company_name).map(f => ({ ...f, profile: '' }));
  return list.map(f => ({
    name: f.name,
    title: f.title,
    linkedin: f.profile || linkedinSearch(f.name, article.company_name),
    isSearch: !f.profile,
  }));
}

/** CEO email first, then the recruiting email, then another public company email. */
export function preferredEmail(company: Company): CardEmail | null {
  const ceo = (company.founders ?? []).find(f => f.email && /CEO|chief executive/i.test(f.title));
  if (ceo) return { address: ceo.email, kind: 'CEO' };
  if (company.recruiting_email) return { address: company.recruiting_email, kind: 'recruiting' };
  if (company.public_email) return { address: company.public_email, kind: 'company' };
  return null;
}

const MAX_SUMMARY = 110;
function shorten(value: string) {
  let text = value
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim()
    .replace(/^(?:which|that|who)\s+/i, '')
    .replace(/[.;:,]+$/, '');
  if (text.length > MAX_SUMMARY) {
    const cut = text.slice(0, MAX_SUMMARY);
    text = cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]?\s*(?:and|or|of|for|to|the|a|an|with)?$/i, '') + '…';
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A short "what they do" phrase rather than full article text. */
export function briefSummary(company: Company, article: FundingArticle): string {
  const name = escape(article.company_name);
  const text = article.summary
    .replace(/\(([^)]*Photo[^)]*)\)/gi, ' ')
    // "Technology, Inc., today announced" is not the end of a sentence.
    .replace(/\b(Inc|Corp|Ltd|Co|LLC|U\.S)\./g, '$1')
    .replace(/\s+/g, ' ');
  const clauses = [
    // "Finpilot, which uses AI agents to ..., has raised"
    new RegExp(
      `${name}\\s*,\\s*(?:which|that)\\s+(.{10,220}?)(?:,\\s*(?:has|have|is|was|raised|announced|today|said)\\b|\\.\\s)`,
      'i',
    ),
    // "Kalepa, an AI underwriting platform, ..."
    new RegExp(`${name}\\s*,\\s*(?:an?|the)\\s+([^,.]{10,160})`, 'i'),
    // "Siggy has raised $6 million ... to build a mental health service that ..." /
    // "RadianX ... announced $9 million ... to scale production of its certified perovskite solar modules"
    new RegExp(
      `${name}[^.]{0,120}?\\b(?:has\\s+)?(?:raised|secured|closed|landed|announced)\\b[^.]{0,160}?\\bto\\s+(?:build|develop|create|launch|offer|provide|scale|expand|grow)\\s+(?:(?:production|adoption|sales|use|deployment)\\s+of\\s+)?(?:its\\s+|their\\s+)?([^.]{10,200})`,
      'i',
    ),
    // Press-release boilerplate: "RadianX is a maker of ..." (not "is a participant in ...").
    new RegExp(
      `${name}\\s+is\\s+(?:an?|the)\\s+(?!(?:participant|member|partner|winner|finalist|recipient|graduate|portfolio)\\b)([^.]{10,160})`,
      'i',
    ),
  ];
  for (const pattern of clauses) {
    const match = text.match(pattern);
    if (match) return shorten(match[1]);
  }
  // The website description, when research found the website (not the article fallback).
  const site = company.product_summary?.trim();
  if (site && !text.startsWith(site.slice(0, 60).replace(/\s+/g, ' '))) {
    const first = site.match(/^.{15,}?[.!?](?=\s|$)/)?.[0] ?? site;
    return shorten(first);
  }
  // Last resort: the first sentence about the company, starting at its name so bylines and
  // press-release datelines ("Nov. 5, 2026 /PRNewswire/ --") before it are dropped.
  const sentence = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.slice(Math.max(0, s.search(new RegExp(`\\b${name}\\b`, 'i')))))
    .find(
      s =>
        new RegExp(`^${name}\\b`, 'i').test(s) &&
        s.length > 40 &&
        !/co-?founder and CEO \p{Lu}\S+ \p{Lu}\S+\.$/u.test(s),
    );
  return sentence ? shorten(sentence) : '';
}

/** "finpilot.com" for display, linking to the full URL. */
export const websiteLabel = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
