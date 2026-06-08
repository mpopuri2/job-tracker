function extractJobData() {
  // ── Helpers ──
  function text(el) { return el ? (el.innerText || el.textContent || '').trim() : '' }
  function q(sel) { try { return document.querySelector(sel) } catch(e) { return null } }
  function qAll(sel) { try { return Array.from(document.querySelectorAll(sel)) } catch(e) { return [] } }
  function meta(name) {
    return (q(`meta[property="${name}"]`) || q(`meta[name="${name}"]`) || {}).content || ''
  }

  // Helper: convert element to clean text with proper section breaks
  function elToText(el) {
    if (!el) return ''
    const clone = el.cloneNode(true)
    clone.querySelectorAll('script,style,nav,header,footer,button,[class*="cookie"],[class*="modal"],[class*="apply"]').forEach(n => n.remove())
    clone.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(n => { n.prepend('\n\n'); n.append('\n') })
    // Treat standalone <strong>/<b> that are the only child of their parent as section headers
    clone.querySelectorAll('strong,b').forEach(n => {
      const p = n.parentElement
      if (p && p.children.length === 1 && p.textContent.trim() === n.textContent.trim()) {
        n.prepend('\n\n'); n.append('\n')
      }
    })
    clone.querySelectorAll('li').forEach(n => n.prepend('\n• '))
    clone.querySelectorAll('p,br,div,section,tr').forEach(n => n.prepend('\n'))
    return clone.textContent
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      // Add line breaks before section headers (capitalized phrase ending with colon)
      .replace(/ ([A-Z][A-Za-z &\/]{4,60}:)\s/g, '\n\n$1\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }


  // ── Site-specific extractors ──
  const hostname = location.hostname

  // LinkedIn — class names change, use multiple fallbacks
  if (hostname.includes('linkedin.com')) {
    const liTitle = text(q([
      '.job-details-jobs-unified-top-card__job-title h1',
      '.jobs-unified-top-card__job-title h1',
      'h1.t-24', 'h1',
    ].join(',')))
    const liCompany = text(q([
      '.job-details-jobs-unified-top-card__company-name a',
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name a',
      '.jobs-unified-top-card__company-name',
    ].join(',')))
    const liLocation = text(q([
      '.job-details-jobs-unified-top-card__primary-description-container .t-black--light',
      '.jobs-unified-top-card__bullet',
      '[class*="job-details"][class*="location"]',
    ].join(','))).split('·')[0].split('·')[0].trim()
    const liDesc = elToText(q([
      '#job-details .jobs-description-content__text',
      '#job-details',
      '.jobs-description__content',
      '.jobs-description-content__text',
      '[class*="description__content"]',
    ].join(',')))
    const liId = (location.pathname.match(/\/jobs\/view\/(\d+)/) || [])[1] || ''
    return { title: liTitle, company: liCompany, location: liLocation, jobType: '', jobId: liId, description: liDesc, url: location.href }
  }

  // Microsoft careers — JSON-LD has the data, use it
  if (hostname.includes('microsoft.com')) {
    // Parse JSON-LD directly for Microsoft
    let msJob = null
    for (const s of qAll('script[type="application/ld+json"]')) {
      try {
        const d = JSON.parse(s.textContent)
        const nodes = Array.isArray(d['@graph']) ? d['@graph'] : [d]
        const job = nodes.find(n => String(n['@type']).includes('JobPosting'))
        if (job) { msJob = job; break }
      } catch(e) {}
    }
    const msTitle    = msJob ? (msJob.title || msJob.name || '').trim() : ''
    const msId       = new URL(location.href).searchParams.get('jobId') ||
                       new URL(location.href).searchParams.get('jobid') ||
                       (location.href.match(/jobId=(\d+)/i) || [])[1] || ''
    const msLocation = msJob && msJob.jobLocation
      ? (() => { const a = (Array.isArray(msJob.jobLocation) ? msJob.jobLocation[0] : msJob.jobLocation).address || {}; return [a.addressLocality, a.addressRegion].filter(Boolean).join(', ') })()
      : ''
    const msType     = msJob ? (msJob.employmentType || '') : ''
    // Strip HTML from JSON-LD description
    const msDescRaw  = msJob ? msJob.description || '' : ''
    let msDesc = ''
    if (msDescRaw) {
      const tmp = document.createElement('div')
      tmp.innerHTML = msDescRaw
      msDesc = elToText(tmp)
    }
    if (!msDesc) msDesc = elToText(q('main'))
    return { title: msTitle, company: 'Microsoft', location: msLocation, jobType: msType, jobId: msId, description: msDesc, url: location.href }
  }

  // ADP (multiple portals)
  if (hostname.includes('adp.com') || hostname.includes('workforcenow')) {
    const adpTitle   = text(q('[class*="jobTitle"], [class*="job-title"], [class*="position-title"], h1'))
    const adpCompany = text(q('[class*="companyName"], [class*="company-name"], [class*="employer"]')) ||
                       hostname.replace(/^(careers|jobs|apply)\./,'').split('.')[0].replace(/[-_]/g,' ').replace(/\w/g,c=>c.toUpperCase())
    const adpLoc     = text(q('[class*="location"], [class*="jobLocation"]')).replace(/^location[:\s]*/i,'').trim()
    const adpType    = text(q('[class*="jobType"], [class*="employment-type"], [class*="work-type"]')).replace(/^(job|work).?type[:\s]*/i,'').trim()
    const adpId      = new URL(location.href).searchParams.get('jobId') ||
                       new URL(location.href).searchParams.get('reqId') ||
                       new URL(location.href).searchParams.get('requisitionId') ||
                       (location.pathname.match(/\/(\d{4,})/) || [])[1] || ''
    const adpDesc    = elToText(q('[class*="jobDescription"], [class*="job-description"], [class*="description__content"], main'))
    return { title: adpTitle, company: adpCompany, location: adpLoc, jobType: adpType, jobId: adpId, description: adpDesc, url: location.href }
  }

  // ── Parse all JSON-LD on the page — most reliable source ──
  let ldJob = null
  try {
    for (const s of qAll('script[type="application/ld+json"]')) {
      try {
        const d = JSON.parse(s.textContent)
        // Handle both direct JobPosting and @graph array
        const nodes = Array.isArray(d['@graph']) ? d['@graph'] : [d]
        const job = nodes.find(n => (n['@type'] || '').includes('JobPosting'))
        if (job) { ldJob = job; break }
      } catch(e) {}
    }
  } catch(e) {}

  // ── Title ──
  let title = ldJob ? (ldJob.title || ldJob.name || '').trim() : ''
  if (!title) {
    // og:title — strip company name suffix patterns
    title = meta('og:title')
      .replace(/\s*[\|–\-]\s*.+$/, '')   // strip "| Company" or "- Company"
      .replace(/\s+at\s+.+$/i, '')        // strip "at Company"
      .trim()
  }
  if (!title || title.length < 3 || /^(careers|jobs|home|search|find)$/i.test(title)) {
    for (const h of qAll('h1')) {
      const t = text(h)
      if (t && t.length > 3 && t.length < 150 && !/^(careers|jobs|home|search|sign in)$/i.test(t)) {
        title = t; break
      }
    }
  }
  if (!title) title = document.title.replace(/\s*[\|–\-]\s*.+$/, '').trim()

  // ── Company ──
  let company = ldJob && ldJob.hiringOrganization ? (ldJob.hiringOrganization.name || '').trim() : ''
  if (!company) {
    const siteName = meta('og:site_name')
    // Only use og:site_name if it's NOT a known job board
    if (siteName && !/^(linkedin|indeed|glassdoor|ziprecruiter|monster|dice|workday|greenhouse|lever|workable|brassring|taleo|icims|smartrecruiters)$/i.test(siteName)) {
      company = siteName
    }
  }
  if (!company) {
    try {
      const host = location.hostname
      const sub  = host.split('.')[0]
      const segs = location.pathname.split('/').filter(s => s && s.length > 2)
      if (['apply','jobs','careers','boards','job','recruit'].includes(sub) && segs.length > 0) {
        company = segs[0].replace(/[-_]/g,' ').replace(/\w/g, c => c.toUpperCase())
      } else {
        const h = host.replace('www.','').replace('careers.','').replace('jobs.','').replace('apply.','').split('.')[0]
        company = h.replace(/[-_]/g,' ').replace(/\w/g, c => c.toUpperCase())
      }
    } catch(e) {}
  }

  // ── Location ──
  let location_ = ''
  if (ldJob && ldJob.jobLocation) {
    const loc = Array.isArray(ldJob.jobLocation) ? ldJob.jobLocation[0] : ldJob.jobLocation
    const addr = loc.address || loc
    const parts = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(s => s && s.length > 0)
    location_ = parts.join(', ')
    // If only country code, try city+region
    if (location_.length < 4) location_ = [addr.addressLocality, addr.addressRegion].filter(Boolean).join(', ')
  }
  if (!location_) {
    for (const sel of [
      '[data-automation-id="locations"] dd','[data-automation-id="locations"] li',
      '[data-testid="job-location"]','[itemprop="addressLocality"]',
      '[class*="job-location"]','[class*="jobLocation"]',
    ]) {
      const el = q(sel); if (!el) continue
      const t = text(el).replace(/^locations?\s*/i,'').replace(/^primary location[:\s]*/i,'').trim()
      if (t && t.toLowerCase() !== 'location' && t.length < 200) { location_ = t; break }
    }
  }

  // ── Job Type ──
  let jobType = ldJob && ldJob.employmentType
    ? (Array.isArray(ldJob.employmentType) ? ldJob.employmentType[0] : ldJob.employmentType).replace(/_/g,' ').toLowerCase().replace(/\w/g, c => c.toUpperCase())
    : ''
  if (!jobType) {
    for (const sel of ['[data-automation-id="time-type"] dd','[data-automation-id="time-type"]','[class*="employment-type"]','[class*="job-type"]']) {
      const el = q(sel); if (!el) continue
      const dd = el.querySelector('dd') || el.querySelector('li')
      const t = text(dd || el).replace(/^time.?type\s*/i,'').replace(/^job.?type\s*/i,'').trim()
      if (t && t.length < 60) { jobType = t; break }
    }
  }

  // ── Description ──
  // Best approach: try structured data, then specific selectors, then biggest block
  let description = ''

  // 1. Structured data (most reliable)
  try {
    const ld = qAll('script[type="application/ld+json"]')
    for (const s of ld) {
      const d = JSON.parse(s.textContent)
      const desc = d.description || (Array.isArray(d['@graph']) && d['@graph'].find(x => x['@type'] === 'JobPosting')?.description)
      if (desc && desc.length > 100) {
        const tmp = document.createElement('div')
        tmp.innerHTML = desc
        description = elToText(tmp)
        break
      }
    }
  } catch(e) {}

  // 2. Known ATS selectors
  if (!description) {
    const sels = [
      '[data-automation-id="richTextViewer"]',
      '[data-automation-id="job-posting-details"]',
      '#jobDescriptionText', '.jobsearch-jobDescriptionText',
      '.posting-description', '[class*="job-description"]',
      '[class*="jobDescription"]', '[class*="job-details"]',
      '[data-testid="job-description"]', '#job-description',
      '.description__text', '[class*="jobBody"]',
    ]
    for (const sel of sels) {
      const el = q(sel); if (!el) continue
      const t = elToText(el)
      if (t.length > 200) { description = t; break }
    }
  }

  // 3. Find the biggest text block on the page
  if (!description) {
    const skip = new Set(['SCRIPT','STYLE','NAV','HEADER','FOOTER','ASIDE'])
    let best = '', bestScore = 0
    for (const el of qAll('div, section, article, main')) {
      if (el.closest('nav,header,footer,aside')) continue
      if (skip.has(el.tagName)) continue
      const t = elToText(el)
      const keywords = (t.match(/responsibilities|requirements|qualifications|experience|skills|about|role|position/gi) || []).length
      const score = t.length + keywords * 200
      if (score > bestScore && t.length > 300 && t.length < 30000) {
        best = t; bestScore = score
      }
    }
    description = best
  }

  description = description.replace(/\n{3,}/g,'\n\n').trim()

  // ── Job ID ──
  let jobId = ''
  if (ldJob && ldJob.identifier) {
    const id = ldJob.identifier
    jobId = (typeof id === 'object' ? (id.value || id['@value'] || '') : id).toString().trim()
  }

  if (!jobId) {
    const p = new URL(location.href)
    const segs = p.pathname.split('/').filter(s => s)
    const last = segs[segs.length - 1] || ''
    // Workday: Title_R0097305
    if (last.includes('_') && /[A-Z]\d{4,}/.test(last.split('_').pop())) jobId = last.split('_').pop()
    // Pure numeric in any segment
    if (!jobId) for (const s of segs) { if (/^\d{5,}$/.test(s)) { jobId = s; break } }
    // All-caps alphanumeric (Workable: 9DB737110F)
    if (!jobId && /^[A-Z0-9]{6,}$/.test(last)) jobId = last
    // UUID
    if (!jobId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(last)) jobId = last
    // JR-1234, IRC-5678
    if (!jobId && /^[A-Za-z]{1,4}[-_]\d{3,}/.test(last)) jobId = last
    // Second-to-last segment
    if (!jobId && segs.length >= 2) {
      const prev = segs[segs.length - 2]
      if (/^[A-Z0-9]{6,}$/.test(prev) || /^\d{5,}$/.test(prev)) jobId = prev
    }
    // Query params — real IDs only (not tracking UUIDs)
    const realParams = ['jobid','job_id','jobId','jid','requisitionId','req_id','jk']
    for (const param of realParams) {
      const v = p.searchParams.get(param)
      if (v && /\d/.test(v) && !/^[0-9a-f]{16,}$/i.test(v)) { jobId = v; break }
    }
  }

  return {
    title:       title.slice(0, 200),
    company:     company.slice(0, 200),
    location:    location_.slice(0, 300),
    jobType:     jobType.slice(0, 100),
    jobId:       jobId.slice(0, 100),
    description: description.slice(0, 15000),
    url:         location.href,
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_JOB_DATA') sendResponse(extractJobData())
})
