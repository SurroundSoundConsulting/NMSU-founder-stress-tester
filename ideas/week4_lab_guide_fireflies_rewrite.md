# **Week 4 Lab Guide**

# **Hive Mind Part 2**

# **Fireflies Polling to Operational Action Board**

## **Why we changed the input layer**

For this workshop, Fireflies is a safer and more accessible transcript source than Google Meet transcripts.

Google Meet transcript availability still depends on account type, Workspace edition, admin settings, device support, and related feature availability rather than being universally available across all participants. Google’s help materials continue to describe transcript access in edition-specific terms and note that consumer accounts do not include all available Meet features. citeturn908703search10turn908703search14turn908703search16

Fireflies is a better fit for this class because its official API documentation assumes standard API-key access for authenticated users, and Fireflies’ documentation also emphasizes direct access to meeting transcripts and related meeting data through its API and MCP tooling. Architecturally, that gives us a much cleaner Week 4 system: one transcript source, one polling workflow, one operational action board. citeturn811454search6turn811454search8turn811454search9

This means Week 4 is no longer about hunting for Meet-generated Docs in Drive.

It is about building a repeatable operational system:

**Fireflies transcript source → polling workflow → Hive Mind processing → founder command-center sheet**

---

## **What you’ll build today**

Today you will extend Hive Mind so it can automatically pull in newly completed meeting transcripts from Fireflies and turn them into structured operational output.

This version will:

* run a polling job every 15 minutes  
* check Fireflies for newly completed meeting transcripts  
* support a one-time backfill mode for recent historical transcripts  
* skip any transcript that has already been processed  
* fetch transcript text and meeting metadata from Fireflies  
* process transcripts in batch through Hive Mind  
* merge extracted tasks into the founder’s existing command-center Google Sheet  
* deduplicate tasks before adding or updating rows  
* add or preserve a stable Task ID for each task  
* write operational fields such as status, blockers, dependencies, due date, OKR link, and risk flag  
* log processed transcript IDs for transcript-level idempotency

By the end of the lab, you should have:

* a new branch for your Week 4 work  
* a working polling-based Fireflies integration  
* transcript ingestion from Fireflies  
* transcript batch processing and backfill  
* structured output merged into the founder command-center sheet  
* transcript-level idempotency  
* task-level deduplication  
* a Google Sheet that behaves more like a lightweight founder operating board  
* your code saved and documented in GitHub

---

## **Starting point**

For this lab, assume you already have:

* your Week 3 / Hive Mind Part 1 system  
* a Google Sheet acting as persistent task memory  
* a founder command-center sheet where tasks are reviewed and managed  
* a working Cursor project for Hive Mind  
* a Fireflies account and API key  
* a clear sense of the core Hive Mind output structure

You are **not** rebuilding the entire app from scratch today.

You are upgrading the same system with:

* a real transcript connector  
* a repeatable polling workflow  
* aggregation into a persistent command center  
* idempotency and deduplication logic  
* an operational view layer inside Google Sheets

---

## **Architecture note: what this system now is**

This Week 4 build has two distinct layers:

### **1. Polling / ingestion layer**

This layer:

* checks Fireflies for recent transcripts  
* fetches transcript text and metadata  
* decides whether the transcript is new  
* logs transcript-level processing state

### **2. Processing / command-center layer**

This layer:

* sends transcript text into Hive Mind logic  
* extracts structured operational output  
* deduplicates tasks against the existing board  
* merges results into the founder’s master Google Sheet  
* supports sorting, filtering, and weekly review

Keeping those layers separate makes the system easier to reason about:

* polling can be retried without rewriting the board  
* backfills can run without breaking recurring sync  
* transcript-level idempotency stays distinct from task-level deduplication  
* the command-center logic can evolve without changing how transcripts are fetched

---

## **Trigger note: manual vs polling vs event-driven**

One open design question is: **what should cause new transcripts to be ingested?**

### **Option A: Manual trigger**

A user runs the polling function manually.

Best for:

* first-time testing  
* debugging  
* controlled backfills

### **Option B: Polling trigger**

A recurring job runs every 15 minutes, every hour, or on another schedule.

Best for:

* a workshop implementation  
* lightweight production use  
* simple and reliable repeated sync

### **Option C: Event-driven trigger**

A webhook fires when a new transcript becomes available.

Best for:

* a more advanced future version  
* near-real-time automation

For this lab, we are using **polling** because it is the simplest approach that still feels like a real operational system.

---

# **Part 1: Create a new branch for Week 4 work**

## **Step 1**

Open your existing Hive Mind project in Cursor.

## **Step 2**

Open the Cursor terminal.

## **Step 3**

Run:

```bash
git checkout -b hive-mind-fireflies-polling
```

### **Checkpoint**

You should now be working on a new branch called:

`hive-mind-fireflies-polling`

You can confirm with:

```bash
git branch
```

The current branch should be marked with `*`.

---

# **Part 2: Create or confirm your command-center sheet structure**

Before building the polling workflow, define the sheets the system will use.

## **Step 1**

Open your founder command-center Google Sheet.

## **Step 2**

Add or confirm these tabs:

* `Master Action Board`  
* `Processed Transcripts`  
* `Polling Log`  
* `Config`  

## **Step 3**

In `Processed Transcripts`, add these columns:

* `fireflies_transcript_id`  
* `meeting_title`  
* `meeting_date`  
* `processed_at`  
* `status`  
* `source_url`  

## **Step 4**

In `Polling Log`, add these columns:

* `timestamp`  
* `step`  
* `fireflies_transcript_id`  
* `message`  

## **Step 5**

In `Master Action Board`, add or confirm these columns:

* `task_id`  
* `task`  
* `owner`  
* `status`  
* `urgency`  
* `due_date`  
* `next_step`  
* `blockers`  
* `dependencies`  
* `okr_link`  
* `risk_flag`  
* `source_transcript_id`  
* `meeting_title`  
* `meeting_date`  
* `created_at`  
* `updated_at`  

### **Checkpoint**

Your command-center workbook should now include both:

* transcript-level logging tabs  
* an operational master board schema

This board is not a separate dashboard product.

It is the founder’s working Google Sheets command center.

Each row is a task.
Each column is a management lens.

---

# **Part 3: Create the Week 4 integration folder in your project**

We are keeping the Fireflies integration code separate from the core Week 3 app logic.

## **Step 1**

In your Hive Mind project, create a new folder called:

`fireflies-polling`

## **Step 2**

Inside that folder, create these files:

* `fireflies_polling_plan.md`  
* `fireflies.js` or `server.js`  
* `.env.example`  

### **Checkpoint**

You should now have a separate place in the project for your Fireflies polling logic.

---

# **Part 4: Use Cursor to plan the Fireflies polling workflow**

We are still using a Cursor-first workflow here: describe the system, review the plan, then let Cursor help generate the code.

## **Step 1**

Open Cursor chat.

## **Step 2**

Paste this prompt into Cursor chat:

```text
I want to design a simple Fireflies polling workflow for Hive Mind.

The system should:

- run every 15 minutes
- check Fireflies for newly completed meeting transcripts
- support a one-time backfill mode for recent historical transcripts
- fetch transcript text and meeting metadata
- skip any transcript that has already been processed
- process each transcript into Hive Mind structured output
- merge extracted tasks into a founder command-center Google Sheet
- deduplicate tasks before adding or updating rows
- preserve a stable Task ID when a task already exists
- log processed Fireflies transcript IDs so the workflow is idempotent

Please do not write the full code yet.

First:

1. explain the architecture in plain English
2. list the files or functions you recommend
3. explain what should be stored in the processed-transcript log
4. explain how polling, processing, and sheet-writing should stay separate
5. explain the difference between transcript-level idempotency and task-level deduplication
6. recommend a simple config structure using environment variables

Keep the design simple and beginner-friendly.
```

## **Step 3**

Read Cursor’s response.

You are looking for a plan that includes:

* a polling function  
* a backfill function  
* a Fireflies API fetch function  
* an idempotency check  
* a transcript processing function  
* a task deduplication function  
* a Google Sheets write function  
* a polling log function

### **Checkpoint**

You should now have a plain-English architecture plan for the polling workflow.

---

# **Part 5: Add your environment variables**

You will need a place for your Fireflies API key and other settings.

## **Step 1**

In the root of your project, confirm that you already have a `.env` file from earlier labs.

If not, create one now.

## **Step 2**

Add the values you will need.

For example:

```env
FIREFLIES_API_KEY=your_fireflies_api_key_here
GOOGLE_SHEET_ID=your_google_sheet_id_here
POLL_LOOKBACK_MINUTES=15
BACKFILL_LOOKBACK_DAYS=7
```

Replace the placeholder values with your real ones.

## **Step 3**

Confirm that `.gitignore` includes:

```text
.env
```

### **Checkpoint**

Your project should now have the Fireflies API key and sheet ID stored in `.env`.

---

# **Part 6: Ask Cursor to generate the first polling version**

Now that the structure is clear, have Cursor generate a first working version of the Fireflies polling logic.

## **Step 1**

Open Cursor chat again.

## **Step 2**

Paste this prompt:

```text
Now generate the first working version of a Fireflies polling workflow for Hive Mind.

Requirements:

- Use Node.js
- keep the code simple and beginner-friendly
- create functions that:
  - poll Fireflies every 15 minutes for newly completed meeting transcripts
  - support a one-time backfill mode for recent transcripts
  - fetch transcript text and meeting metadata
  - check whether a Fireflies transcript ID has already been processed
  - skip already processed transcripts
  - log polling activity
  - send new transcript text into a Hive Mind processing function
  - write structured results into a Google Sheet
  - log the Fireflies transcript ID once processing succeeds

Please separate the logic into clear functions for:
- polling
- backfill
- fetching transcript data
- transcript-level idempotency checking
- processing
- sheet writing
- logging

Use environment variables for:
- FIREFLIES_API_KEY
- GOOGLE_SHEET_ID
- POLL_LOOKBACK_MINUTES
- BACKFILL_LOOKBACK_DAYS

Include comments explaining what each function does.
```

## **Step 3**

Let Cursor generate the code.

## **Step 4**

Review the output.

You should confirm that it includes:

* a polling function  
* a backfill function  
* Fireflies API request logic  
* a lookup against `Processed Transcripts`  
* a processing step  
* a sheet-writing step  
* logging logic

### **Checkpoint**

You should now have a first-pass Fireflies polling implementation.

---

# **Part 7: Add the Hive Mind processing step**

The system should not just pull transcripts. It should turn them into structured operational output.

## **Step 1**

Paste this prompt into Cursor chat:

```text
Now connect the Fireflies polling workflow to Hive Mind processing.

Requirements:

- take transcript text from Fireflies
- process it into Hive Mind structured output
- return at least:
  - Action Items
  - Insights
  - Points of Debate
  - Key Topics Summary
- write Action Items into the founder command-center sheet
- include source metadata such as:
  - Fireflies transcript ID
  - meeting title
  - meeting date
- keep the implementation simple and beginner-friendly
- it is okay to use a placeholder parser function if needed before wiring in the full existing Hive Mind logic
```

## **Step 2**

Let Cursor update the code.

## **Step 3**

Review the code.

You should see:

* transcript text flowing into a Hive Mind processing function  
* structured output being returned  
* source metadata included in the final write step

### **Checkpoint**

Your system should now support:

Fireflies transcript → Hive Mind processing → command-center sheet

---

# **Part 8: Add a simple way to run the poll locally**

For this class, we are assuming polling rather than webhooks.

You should be able to run the polling logic manually while testing.

## **Step 1**

Ask Cursor to add a simple script or route that triggers one polling run.

Example prompt:

```text
Please add a simple way to run one polling cycle locally for testing.

Options:
- an npm script
- a local route
- or a simple function call

Keep it easy to understand.
```

## **Step 2**

Review what Cursor adds.

### **Checkpoint**

You should now have a simple way to trigger one polling cycle during development.

---

# **Part 9: Install dependencies**

Now install any packages added for the Fireflies integration.

## **Step 1**

Open the terminal in Cursor.

## **Step 2**

Run:

```bash
npm install
```

### **Checkpoint**

Your project should now have all required dependencies installed.

---

# **Part 10: Run the system locally**

## **Step 1**

In the Cursor terminal, run:

```bash
npm run dev
```

If that does not work, open `package.json`, look at the `"scripts"` section, and use the correct command Cursor created.

## **Step 2**

If Cursor created a separate local test command for polling, run that as well.

## **Step 3**

Look for a message in the terminal that shows the server is running and/or the polling function is available.

### **Checkpoint**

Your project should now be running locally and ready for a test poll.

---

# **Part 11: Test the polling logic**

Before trusting the system, test the Fireflies polling step carefully.

## **Step 1**

Make sure you have at least one completed Fireflies transcript available in your account.

## **Step 2**

Run one polling cycle manually.

## **Step 3**

Check your terminal logs.

## **Step 4**

Check the `Polling Log` tab in your Google Sheet.

### **Checkpoint**

You should see evidence that the system checked Fireflies and either:

* found new transcripts, or  
* logged that there were no new transcripts to process

---

# **Part 12: Add backfill / hydration mode**

The system should not only handle new transcripts going forward. It should also be able to **hydrate itself** by processing recent historical transcripts when first installed.

## **Step 1**

Open Cursor chat.

## **Step 2**

Paste this prompt:

```text
Please update the Fireflies polling workflow so Hive Mind supports a backfill mode.

Requirements:

- Add a way to process recent transcripts from Fireflies in batch
- Allow a configurable backfill window such as:
  - last 3 days
  - last 7 days
  - last 14 days
  - or latest 20 transcripts
- Keep backfill separate from the normal recurring polling flow
- Log all backfilled Fireflies transcript IDs so the same items are not processed twice later
- Keep the code simple and beginner-friendly
- Add comments explaining which function is for one-time hydration and which is for recurring polling
```

## **Step 3**

Let Cursor update the code.

## **Step 4**

Review the result.

You are looking for:

* a dedicated backfill function  
* a configurable lookback window  
* logging into `Processed Transcripts`  
* no duplication between backfill mode and recurring mode

### **Checkpoint**

Your system should now support both:

* normal recurring sync for new transcripts  
* one-time backfill for recent historical transcripts

---

# **Part 13: Tighten transcript-level idempotency**

Before deduplicating tasks, the system must first prevent the same source transcript from being processed again and again.

This is **transcript-level idempotency**.

## **Step 1**

Confirm that `Processed Transcripts` includes these columns:

* `fireflies_transcript_id`  
* `meeting_title`  
* `meeting_date`  
* `processed_at`  
* `status`  
* `source_url`  

## **Step 2**

Open Cursor chat.

## **Step 3**

Paste this prompt:

```text
Please tighten the transcript-level idempotency logic.

Requirements:

- Do not process the same Fireflies transcript twice
- Use Fireflies transcript ID as the stable identifier
- Before processing any transcript, check Processed Transcripts
- If the transcript has already been processed, skip it
- Log skipped items clearly
- Keep the implementation simple and beginner-friendly
```

## **Step 4**

Let Cursor update the code.

### **Checkpoint**

Your system should now be able to run the same poll twice without creating duplicate transcript entries.

---

# **Part 14: Add stable Task IDs**

Once tasks persist across meetings, you need a stable way to refer to them.

Task IDs make it possible to:

* track the same task across repeated meetings  
* express dependencies between tasks  
* update an existing task instead of creating a duplicate  
* sort or reference a task in a stable way

## **Step 1**

Open Cursor chat.

## **Step 2**

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

## **Step 3**

Let Cursor update the code.

### **Checkpoint**

New tasks should get a Task ID, and existing matched tasks should preserve their original Task ID.

---

# **Part 15: Add task-level deduplication**

Now add the second deduplication layer.

Transcript-level idempotency prevents reprocessing the same source transcript.  
Task-level deduplication prevents repeated meetings from creating repeated task rows.

## **Step 1**

Open Cursor chat.

## **Step 2**

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

## **Step 3**

Let Cursor update the code.

## **Step 4**

Test with two transcripts that mention the same action item in slightly different language.

Example:

* “Send revised deck to investor”  
* “Share updated investor deck”

### **Checkpoint**

The system should merge strong duplicates into one task rather than creating two separate rows.

---

# **Part 16: Add blockers, dependencies, and operational fields**

The command-center board should not only show what needs to happen. It should help the founder see what is stuck, what is waiting on something else, and how current work maps to larger objectives.

## **Step 1**

Open Cursor chat.

## **Step 2**

Paste this prompt:

```text
Please update the Hive Mind extraction and sheet-writing logic to include these operational fields:

- status
- blockers
- dependencies
- okr_link
- due_date
- risk_flag

Requirements:

- Use status values like:
  - open
  - pending
  - blocked
  - done
- Extract blockers when clearly stated or strongly implied
- If no blockers are noted, use `None noted`
- Allow dependencies to refer to Task IDs when possible
- If dependencies are not clear, use `None noted`
- Include a due date when clearly available
- Include a lightweight OKR or objective link when possible
- Include a risk flag when the task appears exposed, blocked, or time-sensitive
- Write all fields into the Master Action Board
- Keep the implementation simple and beginner-friendly
```

## **Step 3**

Let Cursor update the code.

### **Checkpoint**

Newly written task rows should now include values for:

* status  
* blockers  
* dependencies  
* okr_link  
* due_date  
* risk_flag

---

# **Part 17: Improve the command-center merge logic**

Now that the system can ingest transcripts, avoid reprocessing, and deduplicate tasks, it should merge results into the founder’s existing command-center sheet in a way that supports actual weekly use.

We are not creating a new board.

We are improving the founder’s existing system-of-record sheet.

## **Step 1**

Open Cursor chat.

## **Step 2**

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
  - due_date
  - blockers
  - status if appropriate
  - risk_flag
  - okr_link if available
- Keep the code simple and beginner-friendly
```

## **Step 3**

Let Cursor update the code.

### **Checkpoint**

Your task rows should now accumulate into one persistent board instead of being treated like separate one-off outputs.

---

# **Part 18: Add the operational view layer in Google Sheets**

The power of this board is not just in storing tasks.

It is in making them easy to sort, filter, and review.

For this lab, we will keep this lightweight and use the sheet itself as the view layer.

## **Step 1**

In Google Sheets, create useful filters and views for the founder.

Suggested filters:

* by `urgency`  
* by `owner`  
* by `status`  
* by `due_date`  
* by `okr_link`  
* by `risk_flag`  

## **Step 2**

Create one or more saved filter views if you want.

Suggested examples:

* `Highest Urgency`  
* `Blocked Work`  
* `Due This Week`  
* `By Owner`  
* `By OKR`  
* `At Risk`  

## **Step 3**

Optionally add conditional formatting for:

* high urgency  
* blocked status  
* overdue due dates  
* high risk flags

### **Checkpoint**

Your Google Sheet should now behave more like a lightweight founder command center than a raw export table.

---

# **Part 19: Test the full Week 4 workflow**

Now verify the complete operating loop.

## **Step 1**

Make sure you have one or more completed Fireflies transcripts available.

## **Step 2**

Run the polling function.

## **Step 3**

Run the backfill mode if you want to test historical hydration.

## **Step 4**

Check:

* were new transcripts found?  
* were already-processed transcripts skipped?  
* were tasks merged into the Master Action Board?  
* were obvious duplicate tasks consolidated?  
* did each task receive or preserve a Task ID?  
* were blockers and dependencies populated?  
* can you now sort or filter the board by urgency, status, due date, OKR, and risk?

### **Checkpoint**

You should now have a multi-transcript operational workflow that behaves like a lightweight founder task operating system.

---

# **Part 20: Commit your work**

Now save your Week 4 progress in Git.

## **Step 1**

Open the Cursor terminal.

## **Step 2**

Run:

```bash
git status
```

## **Step 3**

Run:

```bash
git add .
```

## **Step 4**

Run:

```bash
git commit -m "Week 4 - Hive Mind Fireflies polling"
```

### **Checkpoint**

You should see confirmation that your commit was created.

If Git asks for your name and email, run:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

Then repeat:

```bash
git commit -m "Week 4 - Hive Mind Fireflies polling"
```

---

# **Part 21: Push your branch to GitHub**

## **Step 1**

In the Cursor terminal, run:

```bash
git push -u origin hive-mind-fireflies-polling
```

## **Step 2**

Refresh your GitHub repository page.

### **Checkpoint**

You should now see your Week 4 Fireflies polling files in GitHub.

---

# **Optional improvements**

If you finish early, try one of these.

## **Option 1: Add a transcript status field**

Add a status like:

* `new`  
* `processed`  
* `skipped`  
* `error`

This makes the processing log easier to read.

## **Option 2: Add a dry-run mode**

Let the polling cycle fetch transcript metadata without writing anything to the sheet.

This is useful for debugging.

## **Option 3: Add a transcript source URL**

Write the Fireflies meeting or transcript URL into the output sheet so users can trace the source.

## **Option 4: Add better polling logs**

Include messages like:

* no new transcripts found  
* skipped already processed transcript  
* processed transcript successfully  
* failed to parse transcript

## **Option 5: Add a transcript limit per run**

Only process the first few new transcripts each cycle.

This can make testing safer and easier to follow.

## **Option 6: Add comments or teammate handoff fields**

If you want to move closer to a lightweight Asana/Jira feel, add columns such as:

* `handoff_to`  
* `comment_note`  
* `follow_up_needed`

---

# **Success checklist**

You are done with the core lab when you have all of these:

* a branch called `hive-mind-fireflies-polling`  
* Fireflies API credentials stored in `.env`  
* a polling-based Fireflies integration  
* a function that checks for newly completed transcripts  
* a one-time backfill / hydration mode  
* logic that skips already processed transcript IDs  
* transcript text flowing into Hive Mind processing  
* transcript-level idempotency via `Processed Transcripts`  
* task-level deduplication in `Master Action Board`  
* stable Task IDs  
* operational fields added for:
  * Status  
  * Blockers  
  * Dependencies  
  * OKR Link  
  * Due Date  
  * Risk Flag  
* structured output merged into the founder command-center sheet  
* a sortable/filterable operational view in Google Sheets  
* a `Polling Log` tab that records system behavior  
* a Git commit created  
* your work pushed to GitHub

---

# **Reflection**

Answer these questions briefly:

1. What part of this workflow felt most like a real operating system rather than a demo?  
2. Did the Google Sheet feel meaningfully closer to a founder command center?  
3. Which part felt most fragile: polling, API fetch, processing, deduplication, or sheet merge logic?  
4. Did Task IDs and dependencies make the board easier to reason about?  
5. Which filtered view would you expect to use most in a real week: urgency, due date, blocked work, owner, OKR, or risk?

---

# **Quick troubleshooting**

## **“The poll runs, but it does not find any transcripts”**

Check:

* that Fireflies has completed at least one transcript  
* that your API key is valid  
* that the lookback window is large enough  
* that your Fireflies query is filtering correctly

## **“The transcript was found, but nothing was written to the sheet”**

Check:

* whether the processing function ran  
* whether the parser step returned valid structured output  
* whether the spreadsheet ID is correct  
* whether the write-to-sheet logic is pointing at the right tab

## **“The same transcript keeps getting processed”**

Check transcript-level idempotency.

Make sure you are logging and checking a stable identifier such as:

* Fireflies transcript ID

## **“The same task keeps appearing in slightly different wording”**

That means transcript-level idempotency is working, but task-level deduplication is still weak.

Tighten the matching logic across:

* normalized task text  
* owner  
* due date

## **“The board works, but it still feels like a dump of extracted rows”**

That means the operational view layer is incomplete.

Improve:

* column structure  
* filter views  
* conditional formatting  
* status consistency  
* OKR and risk fields

## **“The Fireflies API call failed”**

Check that:

* your Fireflies API key is in `.env`  
* the variable name matches the code exactly  
* you restarted the server after editing `.env`  
* the request structure matches what Cursor generated

## **“I can store tasks, but I cannot track the same task across meetings”**

That usually means Task ID logic is missing or not being reused for matched tasks.

## **“I do not understand what this integration is doing”**

Ask Cursor directly:

```text
Explain this Fireflies polling workflow in plain English.
What does each function do?
What is the difference between polling, processing, and sheet writing?
```
