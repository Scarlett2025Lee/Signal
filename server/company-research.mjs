import { load } from 'cheerio';
import { fetchPublicPage,parsePage } from './location-research.mjs';

export function jobTrack(title) {
  if(/\b(product marketing|go.to.market|GTM|growth|marketing|sales|account executive|business development|developer relations|developer advocate|revenue operations)\b/i.test(title))return'GTM';
  if(/\b(data (?:scientist|analyst|engineer|science|analytics)|analytics (?:engineer|manager|analyst)|business intelligence|head of data)\b/i.test(title))return'Data';
  if(/\b(product (?:manager|management|owner|lead)|head of product|director of product|VP[, ]+product)\b/i.test(title))return'PM';
  return null;
}
function https(raw,base){try{const u=new URL(raw,base);u.hash='';return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return'';}}
function linkedin(url,kind){try{const u=new URL(url);return /(^|\.)linkedin\.com$/.test(u.hostname)&&u.pathname.startsWith('/'+kind+'/');}catch{return false;}}
function nameKey(name){return name.toLowerCase().replace(/\b(inc|ltd|llc|corp)\b/g,'').replace(/[^a-z0-9]/g,'');}
export function profileFromPage(html,url,name) {
  const $=load(html);const out={x_url:'',linkedin_url:'',public_email:'',public_phone:'',recruiting_email:'',recruiting_phone:'',founders:[],jobs:[],offices:[],links:[]};
  $('a[href]').each((_i,node)=>{
    const raw=$(node).attr('href');const text=$(node).text().replace(/\s+/g,' ').trim();const link=https(raw,url);
    if(/^mailto:/i.test(raw)){const mail=raw.slice(7).split('?')[0];if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)){if(/^(jobs|careers|talent|recruit|people)/i.test(mail)||/recruit|career|hiring/i.test(text))out.recruiting_email ||=mail;else if(/^(hello|info|contact|support|team)/i.test(mail))out.public_email ||=mail;}return;}
    if(/^tel:/i.test(raw)){const phone=raw.slice(4);if(/recruit|career|hiring/i.test(text))out.recruiting_phone ||=phone;else out.public_phone ||=phone;return;}
    if(!link)return;
    const u=new URL(link);
    if(/(^|\.)(x|twitter)\.com$/.test(u.hostname)&&/^\/[A-Za-z0-9_]+\/?$/.test(u.pathname)&&!/^\/(share|intent|home|login|search)/.test(u.pathname))out.x_url ||=link;
    if(linkedin(link,'company'))out.linkedin_url ||=link;
    if(linkedin(link,'in')){
      let card=$(node).parent();for(let i=0;i<3&&!/founder|co-founder/i.test(card.text())&&card.parent().length;i++)card=card.parent();
      const context=card.text().replace(/\s+/g,' ').trim();
      const heading=card.find('h2,h3,h4,[class*="name"]').first().text().trim();
      const person=heading||(/^[A-Z][a-z]+(?: [A-Z][a-z'-]+){1,3}$/.test(text)?text:'');
      if(person&&person.length<90&&context.length<900&&/\b(?:co[- ]?)?founder\b/i.test(context)){
        const mail=(card.find('a[href^="mailto:"]').first().attr('href')||'').replace(/^mailto:/i,'').split('?')[0];
        const phone=(card.find('a[href^="tel:"]').first().attr('href')||'').replace(/^tel:/i,'');
        out.founders.push({name:person,title:/CEO/i.test(context)?'Founder / CEO':'Founder',profile_url:link,email:/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)?mail:'',phone:phone.slice(0,100),source_url:url});
      }
    }
    const track=jobTrack(text);if(track&&text.length<160&&/career|jobs|positions|openings|greenhouse|lever\.co|ashbyhq|workable|workday|smartrecruiters/i.test(u.href))out.jobs.push({title:text,track,url:link,evidence:text,source_url:url});
    if((u.hostname===new URL(url).hostname||/\.(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com)$/.test(u.hostname))&&/about|team|leadership|contact|career|jobs|locations/i.test(text+' '+u.pathname))out.links.push({url:link,kind:/career|jobs/i.test(text+' '+u.pathname)?'careers':/team|leadership/i.test(text+' '+u.pathname)?'team':/contact|locations/i.test(text+' '+u.pathname)?'contact':'about'});
  });
  function walk(value){if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(walk);return;}
    if([value['@type']].flat().includes('Organization')&&nameKey(value.name||'')===nameKey(name)){
      for(const f of [value.founder??value.founders].flat().filter(Boolean))if(typeof f==='object'&&typeof f.name==='string'&&f.name.length<90){const profile=[f.url,...[f.sameAs].flat()].find(v=>typeof v==='string'&&linkedin(v,'in'))||'';out.founders.push({name:f.name,title:'Founder',profile_url:profile,email:typeof f.email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)?f.email:'',phone:typeof f.telephone==='string'?f.telephone.slice(0,100):'',source_url:url});}
      for(const a of [value.address].flat().filter(Boolean))if(typeof a==='object')out.offices.push([a.streetAddress,a.addressLocality,a.addressRegion,typeof a.addressCountry==='object'?a.addressCountry.name:a.addressCountry].filter(Boolean).join(', '));
      for(const social of [value.sameAs].flat().filter(v=>typeof v==='string')){if(linkedin(social,'company'))out.linkedin_url ||=social;else if(/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[\w]+\/?$/.test(social))out.x_url ||=social;}
    }
    if([value['@type']].flat().includes('JobPosting')&&typeof value.title==='string'){const track=jobTrack(value.title);const link=https(value.url,url);if(track&&link)out.jobs.push({title:value.title,track,url:link,evidence:value.title,source_url:url});}
    for(const key of ['@graph','mainEntity','itemListElement','item'])walk(value[key]);
  }
  $('script[type="application/ld+json"]').each((_i,node)=>{try{walk(JSON.parse($(node).text()));}catch{}});
  return out;
}

export function atsEndpoint(raw){const u=new URL(raw);const board=u.searchParams.get('for')||u.pathname.split('/').filter(Boolean)[0];if(!board||!/^[\w.-]+$/.test(board))return null;if(/(^|\.)greenhouse\.io$/.test(u.hostname))return{kind:'greenhouse',url:`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`};if(u.hostname==='jobs.lever.co')return{kind:'lever',url:`https://api.lever.co/v0/postings/${board}?mode=json`};if(u.hostname==='jobs.ashbyhq.com')return{kind:'ashby',url:`https://api.ashbyhq.com/posting-api/job-board/${board}`};return null;}
export async function researchCompany(article,{signal,fetchPage=fetchPublicPage,clock=()=>new Date()}={}) {
  const website=article.company_website;
  const checked=clock().toISOString().slice(0,10);const pages=[];const results=[];let hiringURL='';
  const errors=[];
  const fallback=error=>({complete:true,error,profile:{website:website||'',headquarters:article.hq_location,product_summary:article.summary.slice(0,1500),offices:'',info_source_url:article.source_url,info_checked_on:checked,hiring_source_url:'',hiring_checked_on:checked,hiring_status:'unknown',founders:[],jobs:[]},pages});
  if(!website)return fallback('融资来源未提供可识别的官网链接；扩展资料未取得');
  try {
    const home=await fetchPage(website,{signal});pages.push(home.url);const homeResult=profileFromPage(home.html,home.url,article.company_name);results.push(homeResult);
    const queue=[...new Map(homeResult.links.map(link=>[link.url,link])).values()].sort((a,b)=>['careers','team','about','contact'].indexOf(a.kind)-['careers','team','about','contact'].indexOf(b.kind));
    const seen=new Set([home.url]);
    async function readJobs(link){const endpoint=atsEndpoint(link);if(!endpoint)return null;const page=await fetchPage(endpoint.url,{signal,format:'json'});pages.push(page.url);const data=JSON.parse(page.html);const all=endpoint.kind==='lever'?data:data.jobs;if(!Array.isArray(all))throw Error('招聘数据结构不正确');return all.flatMap(item=>{const title=item.title||item.text;const track=jobTrack(title||'');const url=https(item.absolute_url||item.hostedUrl||item.jobUrl,link);return track&&url?[{title,track,url,evidence:title,source_url:link}]:[];});}
    for(const entry of queue.slice(0,4)){
      if(seen.has(entry.url))continue;seen.add(entry.url);
      try{
      if(entry.kind==='careers'){const jobs=await readJobs(entry.url);if(jobs){hiringURL=entry.url;results.push({...homeResult,founders:[],offices:[],jobs,links:[]});continue;}}
      const page=await fetchPage(entry.url,{signal});pages.push(page.url);if(entry.kind==='careers')hiringURL=page.url;
      const result=profileFromPage(page.html,page.url,article.company_name);results.push(result);
      // Official careers pages often link to their ATS; follow one linked board.
      if(entry.kind==='careers')for(const board of result.links.filter(link=>link.kind==='careers'&&!seen.has(link.url)).slice(0,1)){
        seen.add(board.url);const jobs=await readJobs(board.url);if(jobs){results.push({...homeResult,founders:[],offices:[],jobs,links:[]});continue;}const boardPage=await fetchPage(board.url,{signal});pages.push(boardPage.url);results.push(profileFromPage(boardPage.html,boardPage.url,article.company_name));
      }
      }catch(error){errors.push(`${entry.kind} 页面：${error.message}`);}
    }
    const first=key=>results.find(row=>row[key])?.[key]||'';
    const unique=(list,key)=>[...new Map(list.map(row=>[row[key],row])).values()];
    const founders=unique(results.flatMap(row=>row.founders),'name').slice(0,10);
    const jobs=unique(results.flatMap(row=>row.jobs),'url').slice(0,50).map(job=>({...job,checked_on:checked}));
    const parsed=parsePage(home.html,home.url,article.company_name,{firstParty:true});
    const description=load(home.html)('meta[name="description"]').attr('content')||parsed.text.slice(0,500);
    return{complete:true,error:errors.join('；'),profile:{website:home.url,headquarters:article.hq_location,product_summary:description.slice(0,2000),offices:[...new Set(results.flatMap(row=>row.offices))].join('\n')||article.hq_location,x_url:first('x_url'),linkedin_url:first('linkedin_url'),public_email:first('public_email'),public_phone:first('public_phone'),recruiting_email:first('recruiting_email'),recruiting_phone:first('recruiting_phone'),info_source_url:home.url,info_checked_on:checked,hiring_source_url:hiringURL||home.url,hiring_checked_on:checked,hiring_status:jobs.length?'roles_found':hiringURL&&!errors.length?'no_relevant_roles':'unknown',founders,jobs,research_pages:pages},pages};
  }catch(error){return fallback('官网访问受限：'+error.message);}
}
