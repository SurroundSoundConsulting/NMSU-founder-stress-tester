# Hive Mind Meet Sync — Architecture Plan

## System Purpose

Automatically pull Google Meet artifacts (transcripts, Gemini meeting notes)
from the user's Google Workspace, process them through the Hive Mind AI pipeline,
and merge structured action items into the founder command-center Google Sheet.

## Two-Layer Architecture

### Layer 1: Sync / Ingestion (Apps Script)

- Runs every 15 minutes via time-driven trigger
- Discovers Meet artifacts from:
  - Google Calendar event attachments (requires Advanced Calendar Service)
  - Google Drive title search (always runs as fallback)
- Copies qualifying docs into the shared Drive inbox: `/Hive Mind Inbox/Raw Meet Artifacts`
- Logs every action to the Sync Log sheet tab
- Checks Processed Sources before every copy to prevent duplicates

### Layer 2: Processing / Command Center (Apps Script)

- Reads only from the shared inbox
- Extracts plain text from Google Docs via DocumentApp
- Sends text to OpenAI with the Hive Mind system prompt
- Writes extracted action items into the Master Action Board
- Uses rule-based dedup (normalize task+owner+due_date) before insert-or-update
- Preserves HM-#### Task IDs for updated rows
- Marks processed files in Processed Sources to prevent reprocessing

## Function Inventory

| Function                   | Layer | Trigger            |
|----------------------------|-------|--------------------|
| syncMeetArtifacts()        | 1     | 15-min time trigger|
| discoverFromCalendar()     | 1     | Called by sync     |
| discoverFromDrive()        | 1     | Called by sync     |
| classifyDoc()              | 1     | Called by discover |
| copyToInbox()              | 1     | Called by sync     |
| processInbox()             | 2     | Manual or chained  |
| parseWithHiveMind()        | 2     | Called by process  |
| writeTasksToMasterBoard()  | 2     | Called by process  |
| backfillRecentTranscripts()| Both  | Manual (one-time)  |

## Idempotency Strategy

- Before copying: check Processed Sources by source_file_id AND source_event_id
- After copying: log status = "copied"
- After processing: update status = "processed"
- Recurring sync automatically skips any file with an existing entry

## Sheet Structure

### Master Action Board (16 columns — matches Fireflies Node.js system)
task_id | task | owner | status | urgency | due_date | next_step | blockers |
dependencies | okr_link | risk_flag | source_transcript_id | meeting_title |
meeting_date | created_at | updated_at

### Processed Sources (9 columns)
source_event_id | source_file_id | source_file_name | source_type |
meeting_date | meeting_title | copied_to_inbox_at | processed_at | status

### Sync Log (5 columns)
timestamp | step | source_file_id | source_file_name | message

## Why Separation Matters

- Source discovery stays independent from task extraction
- Ingestion can be retried without reprocessing
- Command-center logic can evolve without changing the sync utility
- Idempotency is easy to reason about: check one tab, one column
