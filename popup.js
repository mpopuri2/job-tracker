let resumeFile = null
let currentUrl = ''
let allApplications = []
let appsCached = false   // skip Drive fetch if already loaded this session

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const manifest = chrome.runtime.getManifest()
  const clientId = manifest.oauth2?.client_id || ''
  if (!clientId || clientId.includes('YOUR_GOOGLE')) {
    document.getElementById('setupScreen').style.display = 'block'
    return
  }

  document.getElementById('header').style.display = 'flex'

  const signedIn = await checkSignedIn()
  if (!signedIn) {
    document.getElementById('signinScreen').style.display = 'block'
    return
  }

  showLoggedIn()
}

function showLoggedIn() {
  document.getElementById('signinScreen').style.display = 'none'
  document.getElementById('tabNav').style.display = 'flex'
  switchTab('log')
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab))
  document.getElementById('logTab').style.display   = tab === 'log'  ? 'block' : 'none'
  document.getElementById('appsTab').style.display  = tab === 'apps' ? 'flex'  : 'none'

  if (tab === 'log') {
    showMainApp()
  } else {
    loadApplications(false)
  }
}

document.getElementById('tabLog').addEventListener('click',  () => switchTab('log'))
document.getElementById('tabApps').addEventListener('click', () => switchTab('apps'))

// ── Log tab ───────────────────────────────────────────────────────────────────

async function showMainApp() {
  document.getElementById('doneScreen').style.display = 'none'
  document.getElementById('mainApp').style.display = 'block'

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  currentUrl = tab.url

  try {
    const data = await chrome.tabs.sendMessage(tab.id, { type: 'GET_JOB_DATA' })
    populate(data)
  } catch(e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
      const data = await chrome.tabs.sendMessage(tab.id, { type: 'GET_JOB_DATA' })
      populate(data)
    } catch(e2) {
      setStatus('Could not extract — fill in manually', 'error')
      showForm({ title:'', company:'', location:'', jobType:'', jobId:'', description:'' })
    }
  }
}

function populate(data) {
  showForm(data)

  // Check all required fields (resume and notes are optional)
  const fields = [
    { id: 'company',     label: 'Company' },
    { id: 'title',       label: 'Job Title' },
    { id: 'location',    label: 'Location' },
    { id: 'jobType',     label: 'Job Type' },
    { id: 'jobId',       label: 'Job ID' },
    { id: 'description', label: 'Job Description' },
  ]

  const missing = fields.filter(f => !document.getElementById(f.id).value.trim())

  if (missing.length === 0) {
    setStatus('✓ Details extracted — review and log', 'success')
  } else if (missing.length === fields.length) {
    setStatus('❌ Failed to fetch — fill in all fields manually', 'error')
  } else {
    setStatus('⚠️ Failed to fetch: ' + missing.map(f => f.label).join(', ') + ' — fill in manually', 'warn')
  }

  fields.forEach(f => highlightMissing(f.id, !document.getElementById(f.id).value.trim()))
}

function highlightMissing(id, isMissing) {
  const el = document.getElementById(id)
  if (!el) return
  if (isMissing) {
    el.style.borderColor = '#f59e0b'
    el.placeholder = el.placeholder || 'Fill in manually'
    el.addEventListener('input', function clear() {
      if (el.value.trim()) el.style.borderColor = ''
      else el.style.borderColor = '#f59e0b'
    })
  } else {
    el.style.borderColor = ''
  }
}

function showForm(data) {
  document.getElementById('title').value       = data.title       || ''
  document.getElementById('company').value     = data.company     || ''
  document.getElementById('location').value    = data.location    || ''
  document.getElementById('jobType').value     = data.jobType     || ''
  document.getElementById('jobId').value       = data.jobId       || ''
  document.getElementById('description').value = data.description || ''
  document.getElementById('form').style.display    = 'block'
  document.getElementById('actions').style.display = 'block'
  document.getElementById('btnLog').disabled = false
}

function setStatus(msg, type) {
  const el = document.getElementById('status')
  el.textContent = msg
  el.className = `status ${type}`
}

// ── Applications tab ──────────────────────────────────────────────────────────

async function loadApplications(forceRefresh = false) {
  if (appsCached && !forceRefresh) {
    renderApplications()
    return
  }

  const list  = document.getElementById('appsList')
  const count = document.getElementById('appsCount')
  const btn   = document.getElementById('btnRefresh')

  list.innerHTML = '<div class="apps-loading">Loading applications…</div>'
  count.textContent = ''
  btn.classList.add('spinning')

  try {
    allApplications = await getApplications()
    appsCached = true
    renderApplications()
  } catch(e) {
    list.innerHTML = `<div class="apps-empty">Failed to load: ${e.message}</div>`
  } finally {
    btn.classList.remove('spinning')
  }
}

function renderApplications() {
  const query = document.getElementById('appsSearch').value.trim().toLowerCase()
  const sort  = document.getElementById('appsSort').value

  let apps = allApplications.filter(a => {
    if (!query) return true
    return (a.company + a.jobTitle + a.location + a.jobType + a.notes)
      .toLowerCase().includes(query)
  })

  apps = apps.slice().sort((a, b) => {
    if (sort === 'date-desc') return new Date(b.dateApplied) - new Date(a.dateApplied)
    if (sort === 'date-asc')  return new Date(a.dateApplied) - new Date(b.dateApplied)
    if (sort === 'company')   return a.company.localeCompare(b.company)
    if (sort === 'title')     return a.jobTitle.localeCompare(b.jobTitle)
    return 0
  })

  document.getElementById('appsCount').textContent = apps.length
    ? `${apps.length} application${apps.length !== 1 ? 's' : ''}${query ? ` for "${query}"` : ''}`
    : ''

  const container = document.getElementById('appsList')

  if (apps.length === 0) {
    container.innerHTML = query
      ? `<div class="apps-empty">No results for "${query}"</div>`
      : '<div class="apps-empty">No applications logged yet.</div>'
    return
  }

  container.innerHTML = apps.map(a => {
    const openUrl = getDriveUrl(a)
    return `
    <div class="app-card" data-url="${escHtml(openUrl)}">
      <div class="app-card-top">
        <div>
          <div class="app-card-title">${escHtml(a.jobTitle || 'Untitled Role')}</div>
          <div class="app-card-company">${escHtml(a.company || '—')}</div>
        </div>
        <div class="app-date">${formatDate(a.dateApplied)}</div>
      </div>
      <div class="app-card-meta">
        ${a.location ? `<span class="app-chip">📍 ${escHtml(a.location)}</span>` : ''}
        ${a.jobType  ? `<span class="app-chip">${escHtml(a.jobType)}</span>`      : ''}
        ${a.resume   ? `<span class="app-chip">📄 ${escHtml(a.resume)}</span>`   : ''}
        <span class="app-chip" style="color:#4ade80">🗂 Drive</span>
      </div>
    </div>`
  }).join('')

  container.querySelectorAll('.app-card').forEach(card => {
    card.addEventListener('click', () => {
      const url = card.dataset.url
      if (url) chrome.tabs.create({ url })
    })
  })
}

// Returns the Drive folder URL for an application.
// New entries have driveUrl stored directly; old entries fall back to a Drive search.
function getDriveUrl(a) {
  if (a.driveUrl && a.driveUrl.startsWith('http')) return a.driveUrl
  const q = encodeURIComponent(`${a.company} ${a.jobTitle}`.trim())
  return `https://drive.google.com/drive/search?q=${q}`
}

function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function formatDate(str) {
  if (!str) return ''
  const d = new Date(str)
  if (isNaN(d)) return str
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

document.getElementById('appsSearch').addEventListener('input',  renderApplications)
document.getElementById('appsSort').addEventListener('change',   renderApplications)
document.getElementById('btnRefresh').addEventListener('click',  () => loadApplications(true))

// ── Auth ──────────────────────────────────────────────────────────────────────

document.getElementById('btnSignIn')?.addEventListener('click', async () => {
  try {
    await signIn()
    showLoggedIn()
  } catch(e) {
    alert('Sign-in failed: ' + e.message)
  }
})

document.getElementById('btnSignOut')?.addEventListener('click', async () => {
  await signOut()
  appsCached = false
  allApplications = []
  document.getElementById('tabNav').style.display     = 'none'
  document.getElementById('logTab').style.display     = 'block'
  document.getElementById('mainApp').style.display    = 'none'
  document.getElementById('doneScreen').style.display = 'none'
  document.getElementById('appsTab').style.display    = 'none'
  document.getElementById('signinScreen').style.display = 'block'
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'log'))
})

document.getElementById('privacyLink')?.addEventListener('click', (e) => {
  e.preventDefault()
  chrome.tabs.create({ url: chrome.runtime.getURL('privacy.html') })
})

// ── Resume picker ─────────────────────────────────────────────────────────────

document.getElementById('btnResume')?.addEventListener('click', () => {
  document.getElementById('resumeInput').click()
})
document.getElementById('resumeInput')?.addEventListener('change', (e) => {
  resumeFile = e.target.files[0] || null
  document.getElementById('resumeDisplay').value = resumeFile ? resumeFile.name : ''
})

// ── Log application ───────────────────────────────────────────────────────────

document.getElementById('btnLog')?.addEventListener('click', async () => {
  const btn = document.getElementById('btnLog')
  btn.disabled = true
  btn.textContent = 'Saving to Drive…'
  setStatus('Uploading to Google Drive…', 'loading')

  const entry = {
    url:         currentUrl,
    jobTitle:    document.getElementById('title').value.trim(),
    company:     document.getElementById('company').value.trim(),
    location:    document.getElementById('location').value.trim(),
    jobType:     document.getElementById('jobType').value.trim(),
    jobId:       document.getElementById('jobId').value.trim(),
    description: document.getElementById('description').value.trim(),
    notes:       document.getElementById('notes').value.trim(),
    resumeFile,
    resumeName:  resumeFile ? resumeFile.name : '',
  }

  try {
    const result = await logToDrive(entry)

    if (result.duplicate) {
      setStatus('⚠️ Already logged this job. Log anyway?', 'warn')
      btn.disabled = false
      btn.textContent = 'Log Again'
      btn.onclick = async () => {
        btn.disabled = true
        btn.textContent = 'Saving…'
        const r2 = await logToDrive(entry, true)
        if (r2.success) { appsCached = false; showDone(entry) }
        else { setStatus('Error: ' + r2.error, 'error'); btn.disabled = false; btn.textContent = 'Log Again' }
      }
      return
    }

    if (result.success) {
      appsCached = false   // force refresh on next Applications tab open
      showDone(entry)
    } else {
      setStatus('Error: ' + (result.error || 'Unknown error'), 'error')
      btn.disabled = false
      btn.textContent = 'Log Application'
    }
  } catch(e) {
    setStatus('Error: ' + e.message, 'error')
    btn.disabled = false
    btn.textContent = 'Log Application'
  }
})

function showDone(entry) {
  document.getElementById('mainApp').style.display = 'none'
  document.getElementById('doneScreen').style.display = 'block'
  document.getElementById('donePath').textContent =
    `Job Application Files / ${entry.company || 'Unknown'} / ${entry.jobTitle || 'Unknown'}`
}

document.getElementById('btnAnother')?.addEventListener('click', () => {
  resumeFile = null
  document.getElementById('doneScreen').style.display = 'none'
  document.getElementById('mainApp').style.display = 'block'
  document.getElementById('form').style.display = 'none'
  document.getElementById('actions').style.display = 'none'
  setStatus('Reading job page…', 'loading')
  showMainApp()
})

init()
