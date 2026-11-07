import { describe, expect, it } from 'vitest';
import { briefSummary, cardFounders, foundersFromText, preferredEmail, websiteLabel } from './companyCard';
import type { Company, FundingArticle } from './lib/api';

// Fictional text in the style of a real funding article (photo caption first, founder named twice).
const articleText =
  'Fixpilot co-founder and CEO Lena Marsh. (Fixpilot Photo) Seattle startup Fixpilot , which uses AI agents to take the paperwork off the plates of people who invest money for hospitals, pension funds and foundations, has raised $10 million in a Series A round. The round was led by Bay Area venture firm Example Capital , with participation from Fixture Ventures. The idea is to let investment teams spend their time on decisions, said Lena Marsh , Fixpilot’s co-founder and CEO, in an interview.';
const article = { company_name: 'Fixpilot', summary: articleText } as FundingArticle;
const company = (overrides: Partial<Company> = {}): Company =>
  ({
    website: '',
    product_summary: articleText.slice(0, 1500),
    public_email: '',
    recruiting_email: '',
    founders: [],
    ...overrides,
  }) as Company;

describe('compact company card', () => {
  it('reads founders from the article when research found none, linking to a LinkedIn search', () => {
    expect(foundersFromText(articleText, 'Fixpilot')).toEqual([{ name: 'Lena Marsh', title: 'Co-founder & CEO' }]);
    expect(foundersFromText('Siggix was founded by Ana Ruiz and Tom Lee in 2023.', 'Siggix')).toEqual([
      { name: 'Ana Ruiz', title: 'Founder' },
      { name: 'Tom Lee', title: 'Founder' },
    ]);
  });

  it('only accepts people tied to this company, in the forms real articles use', () => {
    // Founders of other companies who invested are not this company's founders.
    const siggix =
      'Investors include Example co-founder Ivan Investor and Fixture Health co-founder Tara Backer. Jon Sabba and Edvard Engesæth, co-founders of Siggix. (Courtesy photo) Fixture co-founder and CEO Ivan Investor, who invested personally, backed both.';
    expect(foundersFromText(siggix, 'Siggix')).toEqual([
      { name: 'Jon Sabba', title: 'Co-founder' },
      { name: 'Edvard Engesæth', title: 'Co-founder' },
    ]);
    const radian =
      '"Our job is power," said Josh Dale, Co-founder and Chief Operating Officer of Radix. "We build here," said Vivi Qu, Co-founder and Chief Executive Officer of Radix. "Proud," said Tiger Yan, CEO of PartnerCo.';
    expect(foundersFromText(radian, 'Radix')).toEqual([
      { name: 'Josh Dale', title: 'Co-founder & COO' },
      { name: 'Vivi Qu', title: 'Co-founder & CEO' },
    ]);
    // A surname-only mention is expanded to the full name used earlier in the article.
    const alberg =
      'That led him to a paper by John Alberg, co-founder of Example Investments. Alberg is Fixpilot’s co-founder and executive chairman.';
    expect(foundersFromText(alberg, 'Fixpilot')).toEqual([
      { name: 'John Alberg', title: 'Co-founder & Executive Chairman' },
    ]);
    const [founder] = cardFounders(company(), article);
    expect(founder.isSearch).toBe(true);
    expect(founder.linkedin).toBe('https://www.linkedin.com/search/results/people/?keywords=Lena%20Marsh%20Fixpilot');
  });

  it('prefers researched founders and their profile links', () => {
    const researched = company({
      founders: [
        {
          name: 'Ada Fixture',
          title: 'Founder / CEO',
          profile_url: 'https://www.linkedin.com/in/ada',
          email: '',
          phone: '',
          source_url: '',
        },
      ],
    });
    expect(cardFounders(researched, article)).toEqual([
      { name: 'Ada Fixture', title: 'Founder / CEO', linkedin: 'https://www.linkedin.com/in/ada', isSearch: false },
    ]);
  });

  it('picks the CEO email, then recruiting, then another company email', () => {
    const ceo = {
      name: 'Ada',
      title: 'Founder / CEO',
      profile_url: '',
      email: 'ada@x.example',
      phone: '',
      source_url: '',
    };
    expect(preferredEmail(company({ founders: [ceo], recruiting_email: 'jobs@x.example' }))).toEqual({
      address: 'ada@x.example',
      kind: 'CEO',
    });
    expect(preferredEmail(company({ recruiting_email: 'jobs@x.example', public_email: 'hi@x.example' }))).toEqual({
      address: 'jobs@x.example',
      kind: 'recruiting',
    });
    expect(preferredEmail(company({ public_email: 'hi@x.example' }))).toEqual({
      address: 'hi@x.example',
      kind: 'company',
    });
    expect(preferredEmail(company())).toBeNull();
  });

  it('summarizes the business as a short phrase instead of the whole article', () => {
    const summary = briefSummary(company(), article);
    expect(summary).toMatch(/^Uses AI agents to take the paperwork off the plates of people who invest money/);
    expect(summary.length).toBeLessThanOrEqual(111);
    expect(
      briefSummary(company({ product_summary: 'AI underwriting for small insurers. More text here.' }), {
        company_name: 'Other',
        summary: 'Other raised money.',
      } as FundingArticle),
    ).toBe('AI underwriting for small insurers');
    expect(
      briefSummary(company(), {
        company_name: 'Kalepix',
        summary: 'Kalepix, an AI platform for insurance underwriters, raised $5M.',
      } as FundingArticle),
    ).toBe('AI platform for insurance underwriters');
  });

  it('summarizes from "raised … to build/scale" and skips bylines, datelines and accelerator boilerplate', () => {
    const siggix = {
      company_name: 'Siggix',
      summary:
        'Mary Writer 2 Shares Email Facebook X LinkedIn Siggix has raised $6 million in pre-seed funding to build a mental health service that uses AI to track progress between appointments.',
    } as FundingArticle;
    expect(briefSummary(company(), siggix)).toMatch(/^A mental health service that uses AI to track progress/);
    const radix = {
      company_name: 'Radix',
      summary:
        'REDWOOD CITY, Calif., Nov. 5, 2026 /PRNewswire/ -- Radix, formerly operating as Example Solar Technology, Inc., today announced $9 million in financing to scale production of its certified perovskite solar modules. Radix is a participant in the 2026 Example Accelerator.',
    } as FundingArticle;
    expect(briefSummary(company(), radix)).toBe('Certified perovskite solar modules');
  });

  it('shows the website as its domain', () => {
    expect(websiteLabel('https://www.finpilot.example/about')).toBe('finpilot.example');
  });
});
