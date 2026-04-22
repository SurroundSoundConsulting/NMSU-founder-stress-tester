# Week 4 Lab Guide

# Hive Mind Part 2

# Google Meet Sync to Operational Action Board

## What you’ll build today

Today you will extend Hive Mind so it can automatically pull in newly created Google Meet artifacts and turn them into structured operational output.

This version will:

- run a user-installed Google Apps Script every 15 minutes
- check recent Google Calendar events and/or Google Drive docs for new Meet artifacts
- identify transcript docs and Gemini meeting notes docs
- copy those source docs into a shared Drive inbox at:
  `/Hive Mind Inbox/Raw Meet Artifacts`
- process only from that inbox
- support a one-time backfill mode to hydrate the system from recent transcripts
- write structured results into the founder command-center sheet
- merge extracted tasks into the founder’s existing operational board
- log processed event IDs and file IDs so the same source is not processed twice
- deduplicate repeated tasks across meetings
- add operational fields like Task ID, Status, Blockers, Dependencies, OKR Link, Due Date, and Risk Flag
- make the command-center sheet more usable as a lightweight operating board through sorting, filtering, and view logic

By the end of the lab, you should have:

- a new branch for your Week 4 work
- a working Apps Script project
- a shared Drive inbox folder for raw Meet artifacts
- a basic processing loop from Meet artifact → inbox → action board
- a backfill function for recent transcripts
- transcript-level idempotency that prevents duplicate source processing
- task-level deduplication that reduces duplicate rows in the board
- a founder command-center sheet that behaves more like a lightweight Asana or Jira
- your script code saved and documented

---

## Starting point

For this lab, assume you already have:

- your Week 3 / Hive Mind Part 1 system
- a Google Sheet acting as persistent task memory
- a founder command-center sheet where tasks are reviewed and managed
- a working Cursor project for Hive Mind
- a clear sense of the core Hive Mind output structure

You are **not** rebuilding the entire app from scratch today.

You are adding a real input connector, a recurring sync layer, stronger merge logic, and an operational view layer.

---

## Architecture note

This system has two distinct layers:

### 1. Sync / ingestion layer

A user-installed Google Apps Script checks for new Google Meet artifacts, copies qualifying transcript or notes docs into a shared Drive inbox, and logs what it has already seen.

### 2. Processing / command-center layer

Hive Mind processes only from that inbox, extracts structured operational output, deduplicates tasks, and merges results into the founder’s master Google Sheet.

This separation matters because it keeps the system easier to reason about:

- source discovery stays separate from task extraction
- ingestion can be retried without reprocessing everything
- command-center logic can evolve without changing the sync utility
- idempotency becomes much easier to manage

---

# Part 1: Create a new branch for Week 4 work

## Step 1

Open your existing Hive Mind project in Cursor.

## Step 2

Open the Cursor terminal.

## Step 3

Run:

```bash
git checkout -b hive-mind-meet-sync
```

### Checkpoint

You should now be working on a new branch called:

`hive-mind-meet-sync`

You can confirm with:

```bash
git branch
```

The current branch should be marked with `*`.

---

# Part 2: Create the shared Drive inbox

This folder will act as the system-owned input layer.

Google Meet may create artifacts in the organizer’s My Drive, but Hive Mind will only process files after they have been copied into this shared inbox.

## Step 1

In Google Drive, create a shared Drive or use an existing one that you control.

## Step 2

Inside that shared Drive, create this folder path:

`/Hive Mind Inbox/Raw Meet Artifacts`

## Step 3

Optionally create a second folder for processed or archived files:

`/Hive Mind Inbox/Processed Meet Artifacts`

### Checkpoint

You should now have a shared Drive folder named:

`Raw Meet Artifacts`

This is the only folder your processing logic should treat as the canonical inbox.

---

# Part 3: Create the Apps Script project

We are using Apps Script as the lightweight automation layer that runs on the user’s own Google Workspace account.

## Step 1

Go to:

`https://script.google.com`

## Step 2

Create a new standalone Apps Script project.

## Step 3

Name it something like:

`Hive Mind Meet Sync`

### Checkpoint

You should now be looking at a new Apps Script project.

---

# Part 4: Use Cursor to plan the Apps Script system

We are still using a Cursor-first workflow here: describe the system, review the plan, then let Cursor help generate the code.

## Step 1

In Cursor, create a new folder in your Hive Mind project for Apps Script-related work.

Suggested name:

`apps-script-meet-sync`

## Step 2

Inside that folder, create a file called:

`meet_sync_plan.md`

## Step 3

Open Cursor chat.

## Step 4

Paste this prompt into Cursor chat:

```text
I want to design a user-installed Google Apps Script for Hive Mind.

The script should:

- run every 15 minutes
- check recent Google Calendar events and/or Google Drive docs for new Google Meet artifacts
- find transcript docs and Gemini meeting notes docs
- identify likely source docs by:
  - attached Docs on recent Calendar events
  - doc titles that match patterns like "Notes by Gemini"
  - docs stored in folders like "Meet Recordings" or "Meet Notes" in the organizer's My Drive
- copy qualifying source docs into a shared Drive inbox:
  /Hive Mind Inbox/Raw Meet Artifacts
- process only from that inbox
- write structured output into a founder command-center Google Sheet
- log processed event IDs and file IDs so the workflow is idempotent

Please do not write the full code yet.

First:

1. explain the architecture in plain English
2. list the Apps Script files or functions you recommend
3. explain what data should be logged for idempotency
4. explain how the sync step and processing step should stay separate
5. recommend a simple folder and sheet structure

Keep the design simple and beginner-friendly.
```

## Step 5

Read Cursor’s response.

You are looking for a plan that includes:

- a polling function
- a source-discovery function
- a copy-to-inbox function
- a processing function
- an idempotency log
- a command-center sheet update function

### Checkpoint

You should now have a plain-English architecture plan for the script.

---

# Part 5: Decide on the sheet structure

Before writing code, define the sheets the system will use.

## Step 1

Open your founder command-center Google Sheet.

## Step 2

Add or confirm these tabs:

- `Master Action Board`
- `Processed Sources`
- `Sync Log`
- `Config`

## Step 3

In `Processed Sources`, add these columns:

- `source_event_id`
- `source_file_id`
- `source_file_name`
- `source_type`
- `meeting_date`
- `copied_to_inbox_at`
- `processed_at`
- `status`

## Step 4

In `Sync Log`, add these columns:

- `timestamp`
- `step`
- `source_file_id`
- `source_file_name`
- `message`

### Checkpoint

Your command-center workbook should now include logging tabs for both sync status and idempotency.

---

# Part 6: Ask Cursor to generate the first Apps Script version

Now that the structure is clear, have Cursor generate a first working version of the Apps Script.

## Step 1

Create a file in your project called:

`Code.gs`

## Step 2

Paste this prompt into Cursor chat:

```text
Now generate the first working version of a Google Apps Script for Hive Mind.

Requirements:

- Use beginner-friendly Google Apps Script code
- Create functions that:
  - run the sync process
  - look at recent Calendar events
  - inspect attached Google Docs when available
  - optionally search Drive for recent Docs matching patterns like "Notes by Gemini"
  - copy qualifying docs into the shared Drive folder:
    /Hive Mind Inbox/Raw Meet Artifacts
  - skip any source event or file that has already been logged in Processed Sources
  - log sync activity into Sync Log
- Keep the processing step separate from the copy step
- Assume a later function will process files from the inbox
- Include comments explaining what each function does
- Keep the script simple and easy to follow

Please generate:
- Code.gs
- a short README section explaining setup steps
- comments for where the user should insert folder IDs and spreadsheet IDs
```

## Step 3

Let Cursor generate the code.

## Step 4

Review the output.

You should confirm that it includes:

- a main sync function
- helper functions for Calendar and/or Drive checks
- logic for copying files into the inbox
- a lookup against `Processed Sources`
- log-writing logic

### Checkpoint

You should now have a first-pass Apps Script file that covers the sync and inbox-copy flow.

---

# Part 7: Add configuration values

The script should not hardcode every ID directly into the logic.

## Step 1

In your Apps Script project, identify the values you will need.

These will likely include:

- shared Drive inbox folder ID
- founder command-center spreadsheet ID
- optional processed/archive folder ID
- lookback window in minutes or hours

## Step 2

Either:

- place them at the top of `Code.gs` as constants, or
- store them in the `Config` sheet and have the script read them

## Step 3

Ask Cursor to help simplify the config pattern if needed.

Example prompt:

```text
Please refactor this Apps Script so the configurable IDs and settings are easy to find and edit.
```

### Checkpoint

Your script should now have a clear place where users can update folder IDs and spreadsheet IDs.

---

# Part 8: Add the processing function for the inbox

Now add the second stage of the workflow.

The first stage copies source docs into the shared inbox.  
The second stage processes only files that are already in the inbox.

## Step 1

Paste this prompt into Cursor chat:

```text
Now add the inbox processing step.

Requirements:

- Process only files that are already in:
  /Hive Mind Inbox/Raw Meet Artifacts
- Read the document text from each copied Google Doc
- send that content into the Hive Mind processing logic or placeholder function
- write structured action items into the founder command-center sheet
- add source metadata such as:
  - source file ID
  - source file name
  - meeting date if available
  - source type
- once processed, log the result in Processed Sources
- do not process the same copied file twice
- keep the code simple and beginner-friendly
- it is okay to use a placeholder function for the AI/Hive Mind parsing step if needed
```

## Step 2

Let Cursor update the script.

## Step 3

Review the code.

You should see:

- a function that reads files from the inbox
- logic for extracting Doc text
- a placeholder or real parser step
- a write-to-sheet function
- final processed logging

### Checkpoint

Your script should now support:

source discovery → copy to inbox → process from inbox → write to sheet → log completion

---

# Part 9: Trigger options: manual vs polling vs event-driven

One open system-design question is: **what should cause new transcripts to be ingested?**

There are three common approaches:

## Option A: Manual trigger

A user clicks a button or runs the script manually.

Best for:

- first-time testing
- debugging
- controlled backfills

## Option B: Polling trigger

A time-driven Apps Script trigger runs every 15 minutes, every hour, or on another schedule.

Best for:

- a simple workshop implementation
- lightweight production use
- systems where “near real time” is good enough

## Option C: Event-driven trigger

A webhook or event fires as soon as a new transcript appears.

Best for:

- a future production version
- more advanced automation

For this lab, we are using **polling** because it is the most practical balance of realism and simplicity.

---

# Part 10: Set up the Apps Script trigger

Now make the sync run automatically.

## Step 1

In Apps Script, open the **Triggers** panel.

## Step 2

Create a new trigger for your main sync function.

Suggested settings:

- event source: **Time-driven**
- type of time-based trigger: **Minutes timer**
- interval: **Every 15 minutes**

## Step 3

Authorize the script if Google prompts you.

### Checkpoint

Your script should now be scheduled to run every 15 minutes.

---

# Part 11: Test the sync logic

Before trusting the automation, test the flow carefully.

## Step 1

Choose a recent Google Meet event that has either:

- a transcript doc, or
- a Gemini notes doc

## Step 2

Run the main sync function manually in Apps Script.

## Step 3

Check whether the source doc was copied into:

`/Hive Mind Inbox/Raw Meet Artifacts`

## Step 4

Check the `Sync Log` sheet.

### Checkpoint

You should see evidence that the sync ran and either copied a file or logged why it skipped one.

---

# Part 12: Test the full processing flow

Now confirm that copied docs become structured operational output.

## Step 1

Run the inbox processing function manually.

## Step 2

Open your `Master Action Board` sheet.

## Step 3

Look for:

- newly written action items
- source metadata
- a processed log entry in `Processed Sources`

### Checkpoint

Your system should now perform the full loop:

Meet artifact → shared inbox → structured action board

---

# Part 13: Test idempotency

This is one of the most important parts of the build.

## Step 1

Run the main sync function again on the same time window.

## Step 2

Run the processing function again.

## Step 3

Confirm that the same event or file was **not** duplicated in:

- `Raw Meet Artifacts`
- `Master Action Board`
- `Processed Sources`

### Checkpoint

The system should now skip previously processed sources rather than duplicating them.

---

# Part 14: Add a backfill / hydration mode

The system should not only handle new transcripts going forward. It should also be able to **hydrate itself** by processing a recent batch of transcripts when first installed.

This is how the command center becomes useful quickly instead of starting empty.

## Step 1

Open Cursor chat.

## Step 2

Paste this prompt:

```text
Please update the Apps Script and processing workflow so Hive Mind supports a backfill mode.

Requirements:

- Add a way to process recent transcripts from the shared source in batch
- Allow a configurable backfill window such as:
  - last 3 days
  - last 7 days
  - last 14 days
  - or latest 20 files
- Keep backfill separate from the normal recurring sync flow
- Log all backfilled source file IDs and event IDs so the same items are not processed twice later
- Keep the code simple and beginner-friendly
- Add comments explaining which function is for one-time hydration and which is for recurring sync
```

## Step 3

Let Cursor update the code.

## Step 4

Review the result.

You are looking for:

- a dedicated backfill function
- a configurable lookback window
- logging into `Processed Sources`
- no duplication between backfill mode and recurring mode

### Checkpoint

Your system should now support both:

- normal recurring sync for new transcripts
- one-time backfill for recent historical transcripts

---

# Part 15: Expand the Master Action Board schema

At this point, the system should no longer write only a minimal action list. It should write into a more operational structure that supports the founder’s weekly command-center workflow.

This board is not a separate dashboard product.  
It is a **Google Sheets command center** that behaves like a lightweight Asana or Jira.

Each row is a task.  
Each column is a management lens.

## Step 1

Open the `Master Action Board` tab in your founder command-center sheet.

## Step 2

Add or confirm these columns:

- `task_id`
- `task`
- `owner`
- `status`
- `urgency`
- `due_date`
- `next_step`
- `blockers`
- `dependencies`
- `okr_link`
- `risk_flag`
- `source_file_id`
- `source_file_name`
- `source_event_id`
- `meeting_date`
- `source_type`
- `created_at`
- `updated_at`

## Step 3

Use these suggested status values:

- `open`
- `pending`
- `blocked`
- `done`

## Step 4

Decide how you want to represent a few columns:

### `dependencies`
Use either:

- a comma-separated list of task IDs, or
- `None noted`

### `okr_link`
Use either:

- an OKR name or code
- a short objective label
- or `Unmapped`

### `risk_flag`
Use either:

- `high`
- `medium`
- `low`
- or blank if not applicable

### Checkpoint

Your `Master Action Board` should now look more like an operating board and less like a raw extraction table.

---

# Part 16: Add stable Task IDs

Once tasks persist across meetings, you need a stable way to refer to them.

Task IDs make it possible to:

- track the same task across repeated meetings
- express dependencies between tasks
- update an existing task instead of creating a duplicate
- sort or reference a task in a stable way

## Step 1

Open Cursor chat.

## Step 2

Paste this prompt:

```text
Please update the processing logic so each task in the Master Action Board gets a stable Task ID.

Requirements:

- Generate a unique task ID when a task is first created
- Reuse the existing Task ID if a new transcript refers to the same underlying task
- Keep the Task ID human-readable if possible
- Example format ideas:
  - HM-0001
  - TASK-0001
- Store Task ID in the `task_id` column
- Use Task ID for dependencies and future updates
- Keep the implementation simple and beginner-friendly
```

## Step 3

Let Cursor update the code.

### Checkpoint

New tasks should get a Task ID, and existing matched tasks should preserve their original Task ID.

---

# Part 17: Add transcript-level idempotency

Before deduplicating tasks, the system must first prevent the same source transcript from being processed again and again.

This is **transcript-level idempotency**.

## Step 1

Confirm that `Processed Sources` includes these columns:

- `source_event_id`
- `source_file_id`
- `source_file_name`
- `source_type`
- `meeting_date`
- `copied_to_inbox_at`
- `processed_at`
- `status`

## Step 2

Open Cursor chat.

## Step 3

Paste this prompt:

```text
Please tighten the transcript-level idempotency logic.

Requirements:

- Do not process the same transcript twice
- Use stable identifiers when available:
  - source_event_id
  - source_file_id
- If both are available, use both
- Before copying or processing a file, check Processed Sources
- If the file has already been processed and has not changed, skip it
- Log skipped items clearly
- Keep the implementation simple and beginner-friendly
```

## Step 4

Let Cursor update the code.

### Checkpoint

Your system should now be able to run the same batch twice without creating duplicate source entries.

---

# Part 18: Add task-level deduplication

Now add the second deduplication layer.

Transcript-level idempotency prevents reprocessing the same source file.  
Task-level deduplication prevents repeated meetings from creating repeated task rows.

## Step 1

Open Cursor chat.

## Step 2

Paste this prompt:

```text
Please add task-level deduplication logic to Hive Mind.

Requirements:

- When new tasks are extracted, compare them against existing rows in the Master Action Board
- If two tasks are likely the same underlying task, merge or update the existing row instead of adding a new row
- Use simple, practical matching logic
- Compare at least:
  - normalized task text
  - owner when available
  - due date when available
- It is okay to use lightweight similarity logic rather than a perfect solution
- If the match is strong, update the existing task
- If the match is weak or ambiguous, add a new row
- Preserve the original Task ID when updating an existing task
- Update `updated_at` whenever an existing task is refreshed
- Keep the code simple and beginner-friendly
```

## Step 3

Let Cursor update the code.

## Step 4

Test with two transcripts that mention the same action item in slightly different language.

Example:

- “Send revised deck to investor”
- “Share updated investor deck”

### Checkpoint

The system should merge strong duplicates into one task rather than creating two separate rows.

---

# Part 19: Add blockers and dependencies

The command-center board should not only show what needs to happen. It should help the founder see what is stuck and what is waiting on something else.

## Step 1

Open Cursor chat.

## Step 2

Paste this prompt:

```text
Please update the Hive Mind extraction and sheet-writing logic to include `blockers` and `dependencies`.

Requirements:

- Extract blockers when clearly stated or strongly implied
- If no blockers are noted, use `None noted`
- Allow dependencies to refer to Task IDs when possible
- If dependencies are not clear, use `None noted`
- Write both fields into the Master Action Board
- Keep the implementation simple and beginner-friendly
```

## Step 3

Let Cursor update the code.

### Checkpoint

Newly written task rows should now include values for blockers and dependencies.

---

# Part 20: Add the operational command-center merge logic

Now that the system can ingest transcripts, avoid reprocessing, and deduplicate tasks, it should merge results into the founder’s existing command-center sheet in a way that supports actual weekly use.

We are not creating a new board. We are merging into the founder’s existing system-of-record sheet.

## Step 1

Open Cursor chat.

## Step 2

Paste this prompt:

```text
Please improve the sheet-writing logic so Hive Mind merges extracted task outputs into the founder’s existing Master Action Board.

Requirements:

- Do not treat each transcript as its own isolated output
- Write all task rows into one persistent Master Action Board
- If a task already exists, update the existing row
- If a task is new, append a new row
- Preserve Task ID for existing tasks
- Update fields such as:
  - owner
  - urgency
  - due date
  - blockers
  - status if appropriate
  - risk flag
  - okr link if available
- Keep the code simple and beginner-friendly
```

## Step 3

Let Cursor update the code.

### Checkpoint

Your task rows should now accumulate into one persistent board instead of being treated like separate one-off outputs.

---

# Part 21: Add the operational view layer

The power of this board is not just in storing tasks.  
It is in making them easy to sort, filter, and review.

For this lab, we will keep this lightweight and use the sheet itself as the view layer.

## Step 1

In Google Sheets, create useful filters and views for the founder.

Suggested filters:

- by `urgency`
- by `owner`
- by `status`
- by `due_date`
- by `okr_link`
- by `risk_flag`

## Step 2

Create one or more saved filter views if you want.

Suggested examples:

- `Highest Urgency`
- `Blocked Work`
- `Due This Week`
- `By Owner`
- `By OKR`
- `At Risk`

## Step 3

Optionally add conditional formatting for:

- high urgency
- blocked status
- overdue due dates
- high risk flags

### Checkpoint

Your Google Sheet should now behave more like a lightweight founder command center than a raw export table.

---

# Part 22: Test the full Week 4 workflow

Now verify the complete operating loop.

## Step 1

Place or identify recent transcript / notes files in the shared source workflow.

## Step 2

Run the sync function.

## Step 3

Run the processing function.

## Step 4

Check:

- were new sources copied to the inbox?
- were already-processed sources skipped?
- were tasks merged into the Master Action Board?
- were obvious duplicate tasks consolidated?
- did each task receive or preserve a Task ID?
- were blockers and dependencies populated?
- can you now sort or filter the board by urgency, status, due date, OKR, and risk?

### Checkpoint

You should now have a multi-transcript operational workflow that behaves like a lightweight task operating system.

---

# Part 23: Commit your work

Now save your Week 4 progress in Git.

## Step 1

Open the Cursor terminal.

## Step 2

Run:

```bash
git status
```

## Step 3

Run:

```bash
git add .
```

## Step 4

Run:

```bash
git commit -m "Week 4 - Hive Mind Meet sync"
```

### Checkpoint

You should see confirmation that your commit was created.

If Git asks for your name and email, run:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

Then repeat:

```bash
git commit -m "Week 4 - Hive Mind Meet sync"
```

---

# Part 24: Push your branch to GitHub

## Step 1

In the Cursor terminal, run:

```bash
git push -u origin hive-mind-meet-sync
```

## Step 2

Refresh your GitHub repository page.

### Checkpoint

You should now see your Week 4 Apps Script and related files in GitHub.

---

# Optional improvements

If you finish early, try one of these.

## Option 1: Move processed files to an archive folder

After successful processing, move copied artifacts from:

`Raw Meet Artifacts`

to:

`Processed Meet Artifacts`

This makes the inbox cleaner.

## Option 2: Add source type detection

Have the script label the source as one of:

- `meet_transcript`
- `gemini_notes`
- `unknown_meet_doc`

## Option 3: Add a dry-run mode

Let the script simulate the sync without copying files.

This is useful for debugging.

## Option 4: Add a duplicate-warning log

If the script detects a likely duplicate source or copied artifact, write a special warning row into `Sync Log`.

## Option 5: Add a “last successful sync” cell in Config

Write the last successful sync timestamp into the `Config` tab for easier monitoring.

## Option 6: Add comments or mentions workflow guidance

If you already use Google Sheets comments to tag teammates on due work, document where that behavior would fit in the operational workflow, even if you do not automate it yet.

---

# Success checklist

You are done with the core lab when you have all of these:

- a branch called `hive-mind-meet-sync`
- a shared Drive inbox folder called `Raw Meet Artifacts`
- an Apps Script project created
- a polling trigger that runs every 15 minutes
- a sync function that discovers recent Meet artifacts
- a backfill / hydration mode for recent historical transcripts
- transcript-level idempotency using logged source identifiers
- an inbox-only processing function
- a persistent `Master Action Board` sheet
- columns added or confirmed for:
  - Task ID
  - Status
  - Blockers
  - Dependencies
  - OKR Link
  - Due Date
  - Risk Flag
- task-level deduplication logic
- extracted tasks merged into the founder’s command-center sheet
- a sortable/filterable operational view in Google Sheets
- a `Processed Sources` tab that prevents duplicate processing
- a `Sync Log` tab that records system behavior
- a Git commit created
- your work pushed to GitHub

---

# Reflection

Answer these questions briefly:

1. What part of this workflow felt most like a real operating system rather than a demo?
2. Did the Google Sheet feel meaningfully closer to a founder command center?
3. Which part felt most fragile: source discovery, sync, parsing, deduplication, or sheet merge logic?
4. Did Task IDs and dependencies make the board easier to reason about?
5. Which filtered view would you expect to use most in a real week: urgency, due date, blocked work, owner, OKR, or risk?

---

# Quick troubleshooting

## “The script runs, but it does not find any Meet artifacts”

Check:

- that the Calendar event actually has an attached transcript or notes doc
- that the lookback window is large enough
- that the script has permission to access Calendar, Drive, and Sheets

## “The source doc exists, but it was not copied to the inbox”

Check:

- that the shared Drive folder ID is correct
- that the script is using the right folder
- that the doc was not already logged as processed

## “The system keeps copying the same file”

Check transcript-level idempotency.

Make sure you are logging and checking:

- `source_event_id`
- `source_file_id`

Before copying or processing a file, the script should look up those values in `Processed Sources`.

## “The system keeps reprocessing the same transcript”

That usually means one of these is true:

- the source was copied but not logged correctly
- the idempotency check happens too late in the flow
- the system is checking file names instead of stable IDs

## “The file copied successfully, but nothing appeared in the action board”

Check:

- whether the processing function ran
- whether the parser step returned valid structured output
- whether the spreadsheet ID is correct
- whether the write-to-sheet logic is pointing at the right tab

## “The same task keeps appearing in slightly different wording”

That means transcript-level idempotency is working, but task-level deduplication is still weak.

Tighten the matching logic across:

- normalized task text
- owner
- due date

## “The board works, but it still feels like a dump of extracted rows”

That means the operational view layer is incomplete.

Improve:

- column structure
- filter views
- conditional formatting
- status consistency
- OKR and risk fields

## “I can store tasks, but I cannot track the same task across meetings”

That usually means Task ID logic is missing or not being reused for matched tasks.

## “The script created duplicate tasks”

That means one of two things:

- transcript-level idempotency is incomplete, or
- task-level deduplication is still missing or too weak

## “The trigger is installed, but nothing seems to happen”

Check the Apps Script execution log and your `Sync Log` tab.

The trigger may be running successfully but skipping files because none matched your rules.

## “I do not understand what this script is doing”

Ask Cursor directly:

```text
Explain this Apps Script in plain English.
What does each function do?
What is the difference between the sync step and the processing step?
```
