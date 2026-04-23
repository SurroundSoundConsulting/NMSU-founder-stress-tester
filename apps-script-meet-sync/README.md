# Hive Mind Meet Sync — Setup Guide

## What This Is

A Google Apps Script that automatically pulls Google Meet transcripts and
Gemini meeting notes into your Hive Mind command-center Google Sheet.

## Prerequisites

- Your Week 3 Google Sheet already set up (Master Action Board tab exists)
- A Google Cloud / Workspace account with access to your Meet recordings
- An OpenAI API key

## Step 1: Create the Drive Inbox Folder

1. Open Google Drive
2. Create a new folder: `Hive Mind Inbox`
3. Inside it, create: `Raw Meet Artifacts`
4. Copy the folder ID from the URL:
   `drive.google.com/drive/folders/YOUR_FOLDER_ID`

## Step 2: Create the Apps Script Project

1. Go to https://script.google.com
2. Click **New project**
3. Name it: `Hive Mind Meet Sync`
4. Delete the default `myFunction()` code
5. Paste the full contents of `Code.gs` into the editor

## Step 3: Edit CONFIG Values

At the top of `Code.gs`, fill in:

```javascript
INBOX_FOLDER_ID: 'paste your Raw Meet Artifacts folder ID here',
SPREADSHEET_ID:  'paste your command-center Google Sheet ID here',
OPENAI_API_KEY:  'paste your OpenAI API key here',
```

## Step 4: Enable Advanced Services (for Calendar attachment detection)

1. In Apps Script: **Services** (left sidebar) → **+**
2. Search for **Google Calendar API** → Enable
3. This allows the script to read event attachments

## Step 5: Grant OAuth Permissions

Run any function (e.g., `syncMeetArtifacts`) and follow the OAuth prompt.
Grant access to: Calendar, Drive, Sheets, Docs, and external network calls.

## Step 6: Confirm Sheet Tabs

Your Google Sheet needs these tabs (the script will auto-create headers):
- `Master Action Board`
- `Processed Sources`
- `Sync Log`

Add them manually or the script will create them on first run.

## Step 7: Run Backfill (first time only)

In the Apps Script editor, run:
```
backfillRecentTranscripts(7)
```
This copies the last 7 days of Meet transcripts to the inbox.
Then run `processInbox()` to extract action items.

## Step 8: Set Up the Recurring Trigger

1. Click the **clock icon** (Triggers) in the left sidebar
2. Click **+ Add Trigger**
3. Function: `syncMeetArtifacts`
4. Event source: **Time-driven**
5. Type: **Minutes timer**
6. Interval: **Every 15 minutes**
7. Save

## Daily Usage

- `syncMeetArtifacts()` runs automatically every 15 minutes — discovers and copies new artifacts
- `processInbox()` can be chained or run separately — extracts tasks to Master board
- Check `Sync Log` tab to see what the script is doing
- Check `Processed Sources` to see what has been processed

## Manual Functions

| Function | When to use |
|----------|-------------|
| `syncMeetArtifacts()` | Test the sync manually |
| `processInbox()` | Process inbox manually |
| `backfillRecentTranscripts(7)` | One-time: seed last N days |
| `backfillRecentTranscripts(14)` | One-time: seed last 14 days |

## Troubleshooting

**No files found in Calendar scan:**
- Check that Google Calendar API is enabled under Services
- Verify your Calendar events have attached Docs (not just video links)
- Increase LOOKBACK_MINUTES in CONFIG

**Files found but not copied:**
- Confirm INBOX_FOLDER_ID is correct (check Drive URL)
- Confirm the script has Drive editor access (re-run OAuth prompt)

**Tasks not appearing in Master Action Board:**
- Check that SPREADSHEET_ID is correct
- Verify the tab name exactly matches TAB_MASTER in CONFIG
- Run processInbox() manually and check Sync Log for errors

**Duplicate files in inbox:**
- Check Processed Sources tab — the file should appear there
- If missing, idempotency check is failing — file may have been deleted from Processed Sources

**Same task appearing multiple times:**
- Transcript-level idempotency is working but task dedup is weak on this match
- Normalize the task wording in the source transcript or adjust task descriptions
