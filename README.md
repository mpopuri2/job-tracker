<img src="icons/icon128.png" width="80" alt="Job Tracker">

# Job Tracker - Save to Google Drive

A Chrome extension that saves job applications directly to your Google Drive with one click. Auto-extracts job title, company, location, job type, and full job description from any job posting page.

## Features

- Auto-extracts job details from LinkedIn, Indeed, Workday, Greenhouse, Lever, and more
- Saves everything to your personal Google Drive - no servers, no databases
- Applications tab with search and sort
- Click any logged application to open its Drive folder
- Duplicate detection

## What gets saved

- **Google Sheet** - one row per application with date, company, title, location, job type, URL, resume name, and Drive folder link
- **Job Description.txt** - full job description saved as a text file
- **Resume** - uploaded to `Job Application Files/{Company}/{Role}/`

## Setup

1. Load the extension in Chrome:
   - Go to `chrome://extensions` → enable **Developer mode**
   - Click **Load unpacked** → select this folder

2. Pin it to the toolbar:
   - Click the puzzle 🧩 icon → find **Job Tracker** → click the 📌 pin

3. Click the Job Tracker icon on any job posting page → sign in with Google → log away.

## Privacy

All data saves directly to your personal Google Drive. We never see or touch your data. Only the `drive.file` scope is requested - the extension can only access files it created.

## Bug reports & feedback

Email: manjunathpopuri2@gmail.com

## License

MIT License - © 2026 Manjunath Popuri
