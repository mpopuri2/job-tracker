const SHEET_NAME  = 'Job Applications'
const FOLDER_NAME = 'Job Application Files'
const HEADERS = ['Date Applied','Company','Job Title','Job ID','Location','Job Type','Job URL','Resume','JD File','Notes','Drive Folder']

async function getToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
      else if (!token) reject(new Error('Not signed in'))
      else resolve(token)
    })
  })
}

async function clearToken() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'CLEAR_AUTH_TOKEN' }, () => resolve())
  })
}

async function apiFetch(token, method, url, body, isUpload = false) {
  const headers = { 'Authorization': `Bearer ${token}` }
  if (!isUpload) headers['Content-Type'] = 'application/json'
  const res = await fetch(url, {
    method,
    headers,
    body: body ? (isUpload ? body : JSON.stringify(body)) : undefined,
  })
  if (res.status === 401) {
    // Token expired — clear and throw so caller can retry
    await clearToken()
    throw new Error('AUTH_EXPIRED')
  }
  return res.json()
}

async function withTokenRetry(fn) {
  try {
    const token = await getToken(true)
    return await fn(token)
  } catch(e) {
    if (e.message === 'AUTH_EXPIRED') {
      // Retry once with fresh token
      const token = await getToken(true)
      return await fn(token)
    }
    throw e
  }
}

async function findOrCreateFolder(token, name, parentId = null) {
  let q = `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g,"\\'")}' and trashed=false`
  if (parentId) q += ` and '${parentId}' in parents`
  const res = await apiFetch(token, 'GET',
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`)
  if (res.files && res.files.length > 0) return res.files[0].id
  const meta = { name, mimeType: 'application/vnd.google-apps.folder' }
  if (parentId) meta.parents = [parentId]
  const created = await apiFetch(token, 'POST', 'https://www.googleapis.com/drive/v3/files', meta)
  return created.id
}

async function uploadTextFile(token, name, content, parentId) {
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify({ name, parents: [parentId] })], { type: 'application/json' }))
  form.append('file', new Blob([content], { type: 'text/plain' }))
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: form,
  })
  return res.json()
}

async function uploadBinaryFile(token, file, parentId) {
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify({ name: file.name, parents: [parentId] })], { type: 'application/json' }))
  form.append('file', file)
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: form,
  })
  return res.json()
}

async function findOrCreateSheet(token, rootFolderId) {
  const q = `name='${SHEET_NAME}' and '${rootFolderId}' in parents and trashed=false`
  const res = await apiFetch(token, 'GET',
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`)
  if (res.files && res.files.length > 0) return res.files[0].id
  const created = await apiFetch(token, 'POST', 'https://www.googleapis.com/drive/v3/files', {
    name: SHEET_NAME,
    mimeType: 'application/vnd.google-apps.spreadsheet',
    parents: [rootFolderId],
  })
  const sheetId = created.id
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A1:append?valueInputOption=RAW`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [HEADERS] }),
  })
  return sheetId
}

async function ensureHeaders(token, sheetId) {
  // Read existing header row
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!1:1`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  )
  const data = await res.json()
  const existing = (data.values && data.values[0]) ? data.values[0] : []

  // Add any missing headers at the end
  const missing = HEADERS.filter(h => !existing.includes(h))
  if (missing.length === 0) return

  const nextCol = existing.length + 1
  const colLetter = String.fromCharCode(64 + nextCol) // A=65
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!${colLetter}1:append?valueInputOption=RAW`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [missing] }),
    }
  )
}

async function isDuplicate(token, sheetId, url) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!G:G`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const data = await res.json()
  const urls = (data.values || []).flat()
  return urls.includes(url)
}

async function appendRow(token, sheetId, row) {
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A1:append?valueInputOption=RAW`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  })
}

async function logToDrive(entry, skipDupeCheck = false) {
  return withTokenRetry(async (token) => {
    const rootId    = await findOrCreateFolder(token, FOLDER_NAME)
    const sheetId   = await findOrCreateSheet(token, rootId)
    await ensureHeaders(token, sheetId)

    // Duplicate check
    if (!skipDupeCheck && entry.url) {
      const dupe = await isDuplicate(token, sheetId, entry.url)
      if (dupe) return { success: false, duplicate: true }
    }

    const companyId = await findOrCreateFolder(token, entry.company || 'Unknown', rootId)
    const roleId    = await findOrCreateFolder(token, entry.jobTitle || 'Unknown Role', companyId)

    let jdFileName = ''
    if (entry.description) {
      jdFileName = 'Job Description.txt'
      const jdContent = [entry.jobTitle, entry.company, entry.url, '', entry.description].join('\n')
      await uploadTextFile(token, jdFileName, jdContent, roleId)
    }

    let resumeFileName = ''
    if (entry.resumeFile) {
      resumeFileName = entry.resumeFile.name
      await uploadBinaryFile(token, entry.resumeFile, roleId)
    } else if (entry.resumeName) {
      resumeFileName = entry.resumeName
    }

    const now = new Date()
    const dateTime = now.toLocaleDateString('en-US') + ' ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

    const driveFolderUrl = `https://drive.google.com/drive/folders/${roleId}`

    await appendRow(token, sheetId, [
      dateTime,
      entry.company   || '',
      entry.jobTitle  || '',
      entry.jobId     || '',
      entry.location  || '',
      entry.jobType   || '',
      entry.url       || '',
      resumeFileName,
      jdFileName      ? `${entry.company}/${entry.jobTitle}/${jdFileName}` : '',
      entry.notes     || '',
      driveFolderUrl,
    ])

    return { success: true, company: entry.company, jobTitle: entry.jobTitle }
  })
}

async function checkSignedIn() {
  try {
    await getToken(false)
    return true
  } catch(e) {
    return false
  }
}

async function signIn() {
  return getToken(true)
}

async function signOut() {
  await clearToken()
}

async function getApplications() {
  return withTokenRetry(async (token) => {
    const rootId  = await findOrCreateFolder(token, FOLDER_NAME)
    const sheetId = await findOrCreateSheet(token, rootId)
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A:J`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    )
    const data = await res.json()
    const rows = data.values || []
    if (rows.length <= 1) return []
    return rows.slice(1).map(row => ({
      dateApplied: row[0] || '',
      company:     row[1] || '',
      jobTitle:    row[2] || '',
      jobId:       row[3] || '',
      location:    row[4] || '',
      jobType:     row[5] || '',
      url:         row[6] || '',
      resume:      row[7] || '',
      jdFile:      row[8] || '',
      notes:       row[9] || '',
      driveUrl:    row[10] || '',
    }))
  })
}
