import { load } from 'cheerio';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { EnvHttpProxyAgent, fetch as httpFetch } from 'undici';

const STATES='Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming';
const CITIES='San Francisco|San Jose|Palo Alto|Mountain View|Menlo Park|Redwood City|Boston|Seattle|Austin|Chicago|Los Angeles|San Diego|Miami|Denver|Atlanta|Dallas|Houston|New York City|Brooklyn|Bellevue|Boulder|Philadelphia|Pittsburgh|Nashville|Raleigh|Durham|Washington,?\\s*D\\.?C\\.?';
const us=new RegExp(`\\b(?:United States(?: of America)?|USA|U\\.S\\.(?:A\\.)?|US|${STATES}|${CITIES})\\b`,'i');
const foreign=/\b(Canada|Canadian|Vancouver|Toronto|Montreal|United Kingdom|UK|London|Norway|Norwegian|Oslo|Nordic|Scandinavian|Sweden|Swedish|Stockholm|Finland|Finnish|Helsinki|Denmark|Danish|Copenhagen|Iceland|Reykjavik|Germany|German|Berlin|France|French|Paris|Netherlands|Dutch|Amsterdam|Switzerland|Swiss|Zurich|Spain|Spanish|Madrid|Italy|Italian|Milan|Portugal|Lisbon|Ireland|Dublin|Israel|Israeli|Tel Aviv|India|Indian|Bengaluru|Bangalore|Singapore|Australia|Australian|Sydney|Melbourne|New Zealand|China|Chinese|Beijing|Shanghai|Japan|Tokyo|Brazil|Mexico)\b/i;
const normalize=value=>String(value??'').toLowerCase().replace(/\b(incorporated|inc|llc|ltd|limited|corporation|corp)\b/g,'').replace(/[^\p{L}\p{N}]/gu,'');
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function locationFromText(text,companyName,{firstParty=false}={}) {
  text=text.replace(/\bU\.S\.(?:A\.)?/g,'USA');
  const company=escape(companyName);
  const clauses=[
    new RegExp(`${company}\\s*,\\s*(?:an?\\s+)?([^.!?;]{2,140}?)\\s*[-–—]\\s*based\\b`,'ig'),
    new RegExp(`${company}[^.!?;]{0,80}?\\b(?:headquartered|based)\\s+in\\s+([^.!?;]{2,140})`,'ig'),
    new RegExp(`([^.!?;]{2,100}?)\\s*[-–—]\\s*based\\s+(?:[\\w-]+\\s+){0,4}${company}\\b`,'ig'),
    new RegExp(`\\b(Nordic|Scandinavian|Norwegian|Swedish|Finnish|Danish|Canadian|UK|German|French|Israeli|Indian|Australian)\\s+(?:[\\w/-]+\\s+){0,5}(?:startup|company|firm)\\s+${company}\\b`,'ig'),
  ];
  if(firstParty)clauses.push(/\b(?:our (?:global |corporate )?headquarters|headquartered in|headquarters\s*[:–—-])\s*([^.!?;]{2,140})/ig);
  const evidence=[];
  for(const pattern of clauses)for(const match of text.matchAll(pattern)) {
    const location=match[1].trim().replace(/^in\s+/i,'').replace(/[,\s]+$/,'');
    const nonUS=foreign.test(location);const american=us.test(location)||/\b[A-Za-z ]+,\s*(?:CA|NY|MA|TX|WA|FL|CO|IL|PA|NC|NJ|VA|GA|AZ|UT|OH)\b/.test(location);
    if(nonUS||american)evidence.push({location,kind:nonUS&&american?'conflict':nonUS?'foreign':'us',quote:match[0].slice(0,350)});
  }
  const kinds=new Set(evidence.map(e=>e.kind));
  if(kinds.has('conflict')||(kinds.has('us')&&kinds.has('foreign')))return{kind:'conflict',location:'存在多个总部/地区依据',evidence};
  if(!evidence.length){
    const patterns=[new RegExp(`\\b(?:US|USA|American|United States)[- ]+(?:[\\w/-]+\\s+){0,5}(?:startup|company|firm|platform)\\s+${company}\\b`,'i'),new RegExp(`${company}\\s*,\\s*an?\\s+(?:US|USA|American|United States)[- ]+(?:[\\w/-]+\\s+){0,5}(?:startup|company|firm|platform)\\b`,'i')];
    const match=patterns.map(pattern=>text.match(pattern)).find(Boolean);
    if(match)return{kind:'country_only',country_code:'US',location:'',evidence:[{kind:'country_only',country_code:'US',location:'',quote:match[0]}]};
    return{kind:'unknown',location:'',evidence:[]};
  }
  return{...evidence[0],evidence};
}

export function parsePage(html,url,companyName,{firstParty=false}={}) {
  const $=load(html);const organizations=[];const bodies=[];
  function walk(value){if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(walk);return;}if(value.articleBody)bodies.push(String(value.articleBody));if([value['@type']].flat().includes('Organization')&&normalize(value.name)===normalize(companyName))organizations.push(value);for(const [key,child]of Object.entries(value))if(['@graph','about','mentions','mainEntity','location','founder'].includes(key))walk(child);}
  $('script[type="application/ld+json"]').each((_i,node)=>{try{walk(JSON.parse($(node).text()));}catch{/* Unsupported embedded metadata is not location evidence. */}});
  $('script,style,noscript,nav,header,footer,aside,form,[role="navigation"],.related-posts,.related-articles').remove();
  let main=$('article .entry-content,article .post-content,.article-content,.entry-content,article,main').first();if(!main.length)main=$('body');
  main.find('p,div,br,h1,h2,h3,li').append('\n');
  const text=(bodies[0]||main.text()).replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim().slice(0,60000);
  const structured=[];
  for(const org of organizations)for(const address of [org.address].flat().filter(Boolean)) {
    if(typeof address!=='object')continue;
    const country=typeof address.addressCountry==='object'?address.addressCountry?.name:address.addressCountry;
    const location=[address.addressLocality,address.addressRegion,country].filter(Boolean).join(', ');
    // A matched organization's address is labeled as an address, not falsely as a confirmed global HQ.
    if(location){const american=/^(US|USA|United States(?: of America)?)$/i.test(country??'');const other=country&&!american;structured.push({kind:american?'us':other?'foreign':'unknown',country_code:american?'US':null,location,quote:`${org.name}: ${location} (Organization.address)`});}
  }
  const explicit=locationFromText(text,companyName,{firstParty});
  const evidence=[...explicit.evidence,...structured.filter(e=>e.kind!=='unknown')];
  const kinds=new Set(evidence.map(e=>e.kind));
  const location=kinds.has('conflict')||(kinds.has('us')&&kinds.has('foreign'))?{kind:'conflict',location:'公开资料存在多个地点，需区分总部和办公室',evidence}:explicit.kind!=='unknown'?explicit:structured.find(e=>e.kind!=='unknown')?{...structured.find(e=>e.kind!=='unknown'),kind:'address_only',evidence}:explicit;
  const links=[];
  main.find('a[href]').each((_i,node)=>{try{const link=new URL($(node).attr('href'),url);if(link.protocol==='https:')links.push({url:link.href,text:$(node).text().trim()});}catch{}});
  const structuredWebsite=organizations.map(org=>org.url).find(link=>{try{return typeof link==='string'&&new URL(link).protocol==='https:'&&new URL(link).hostname!==new URL(url).hostname;}catch{return false;}});
  const website=structuredWebsite||links.find(link=>(normalize(link.text)===normalize(companyName)||normalize(new URL(link.url).hostname.replace(/^www\./,'').split('.')[0])===normalize(companyName))&&new URL(link.url).hostname!==new URL(url).hostname&&!/(linkedin|twitter|x)\.com$/.test(new URL(link.url).hostname))?.url||'';
  const about=links.filter(link=>new URL(link.url).hostname===new URL(url).hostname&&/about|company|contact|locations/i.test(link.text+' '+new URL(link.url).pathname)).slice(0,2).map(link=>link.url);
  return {text,location,website,about,evidence:evidence.map(e=>({...e,url}))};
}

export function publicAddress(address) {
  if(isIP(address)===4){const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&[18,19,51].includes(b))||(a===192&&b===0)||(a===203&&b===0));}
  return isIP(address)===6&&/^[23][\da-f]{0,3}:/i.test(address)&&!/^2001:db8:/i.test(address);
}
export async function fetchPublicPage(raw,{signal,resolve=dnsLookup,request=httpFetch,format='html'}={}) {
  let url=new URL(raw);
  for(let redirects=0;redirects<4;redirects++){
    if(url.protocol!=='https:'||url.username||url.password||url.port||isIP(url.hostname.replace(/[\[\]]/g,''))||!url.hostname.includes('.')||/\.(local|localhost|internal|lan|home|test|invalid)$/i.test(url.hostname))throw Error('非公开 HTTPS 地址');
    const addresses=await resolve(url.hostname,{all:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('地址指向本机或私有网络，未访问');
    const target=url.hostname;
    const dispatcher=new EnvHttpProxyAgent({connect:{lookup:(hostname,options,callback)=>{if(hostname!==target){callback(Error('Unexpected direct hostname'));return;}if(options?.all)callback(null,addresses);else{const chosen=addresses.find(a=>!options?.family||a.family===options.family)||addresses[0];callback(null,chosen.address,chosen.family);}}}});
    try{
      const abort=signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000);
      const response=await request(url,{dispatcher,redirect:'manual',signal:abort,headers:{'User-Agent':'SignalFundingReader/0.3.1 (personal research)','Accept':format==='json'?'application/json':'text/html,application/xhtml+xml'}});
      if([301,302,303,307,308].includes(response.status)){url=new URL(response.headers.get('location'),url);continue;}
      if(!response.ok)throw Error(`页面 HTTP ${response.status}`);
      if(!(format==='json'?/application\/json/i:/text\/html|application\/xhtml/i).test(response.headers.get('content-type')||''))throw Error('页面内容类型不匹配');
      let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>2_000_000)throw Error('页面超过 2MB');chunks.push(chunk);}
      return{html:Buffer.concat(chunks).toString('utf8'),url:url.href};
    }finally{await dispatcher.destroy();}
  }
  throw Error('页面重定向次数过多');
}

export async function researchArticle(article,source,{signal,fetchPage=fetchPublicPage}={}) {
  const evidence=[];const errors=[];let body=article.summary;let location=locationFromText(body,article.company_name);let website='';
  try{
    const page=await fetchPage(article.source_url,{signal});
    const parsed=parsePage(page.html,page.url,article.company_name);body=parsed.text||body;if(parsed.location.kind!=='unknown')location=parsed.location;evidence.push(...parsed.evidence);website=parsed.website;
  }catch(error){errors.push('新闻原文：'+error.message);}
  if(location.kind==='unknown'&&website){
    try{
      const page=await fetchPage(website,{signal});const parsed=parsePage(page.html,page.url,article.company_name,{firstParty:true});evidence.push(...parsed.evidence);location=parsed.location;
      if(location.kind==='unknown')for(const link of parsed.about.slice(0,1)){
        const about=await fetchPage(link,{signal});const details=parsePage(about.html,about.url,article.company_name,{firstParty:true});evidence.push(...details.evidence);if(details.location.kind!=='unknown'){location=details.location;break;}
      }
    }catch(error){errors.push('官网：'+error.message);}
  }
  if(!evidence.length)for(const item of location.evidence??[])evidence.push({...item,url:article.source_url});
  return{...article,summary:body.slice(0,16000),hq_location:['country_only','address_only'].includes(location.kind)?'':location.location||'',country_code:location.kind==='us'||location.country_code==='US'?'US':null,location_kind:location.kind,hq_evidence:evidence,research_error:errors.join('；'),company_website:website};
}
