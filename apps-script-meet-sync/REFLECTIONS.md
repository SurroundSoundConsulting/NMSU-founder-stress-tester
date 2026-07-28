# Execution Workbench — Reflections

Drafted from the production runs on 2026-05-07 (Sync Log + Master Action Board),
not from a controlled experiment. **Sample size is small: 10 classified rows, 1
completed execution (HM-0005 → EX-0001).** Where a claim rests on one
observation, it says so. Adjust in your own voice before treating any of this as
settled.

---

**1. Easiest task types to execute well**

Single-artifact, single-audience writing tasks — the "draft a message to a named
person about a thing that already happened in the meeting" shape. HM-0005 (a
follow-up email) went from `Ready for Execution` to a usable draft in one pass
once it knew who the reader was. These work because the transcript already
contains the substance; the model is reformatting known facts, not sourcing new
ones.

Summarisation should belong in this bucket for the same reason, but no
summarisation row has actually completed a run yet, so that's an inference from
the task shape rather than an observation.

**2. Where missing context hurt output quality**

The sharp lesson wasn't about output quality — it was that an over-strict
classifier produces *no output at all*. On the first real pass, **8 of 10 rows
landed `Missing Info`**, and reading column T showed the model demanding speaker
bios, phone numbers, word counts, and portal links. None of those would have
made a draft wrong; they'd have made it slightly less specific. The rubric said
"list concrete gaps" and the model read that as "list everything that would
help."

The fix was to replace that phrase with an explicit test — *would the deliverable
be wrong, misleading, or harmful if sent as-is after a quick edit?* — plus
enumerated blocking and non-blocking lists. Blocking now means the content to
transform doesn't exist, a relied-upon fact would have to be fabricated
(metrics, dollar amounts, past dates, named client results, legal commitments),
or the decision is the owner's alone. Everything cosmetic gets a
`[BRACKETED PLACEHOLDER]` and an "Assumptions & to confirm" list instead.

Genuine context gaps are narrower than they first appear: an unknown *audience*
degrades a draft badly, because tone, length, and framing all hang off it. An
unknown *tone* barely matters — that's a 30-second edit.

**3. Information that improved results most**

For HM-0005, three facts in column R moved it from blocked to shipped:
**audience** (who reads this), **deliverable type** (email vs. summary vs.
brief), and **the specific ask** (confirm a date). Of those, audience did the
most work.

Structurally, the highest-leverage information wasn't per-row at all — it was the
**OKR Registry context** injected into every extraction (32,165 chars). It's what
lets the model tell a real commitment apart from a passing remark, and it's
shared across every row rather than typed in one at a time.

**4. What would I trust this to execute today**

Drafting, with a human sending. `Ready for Review` means "a draft exists," not
"this is correct" — the gate is 4-way (`execution_needed=Yes`,
`is_executable=true`, no blocking `missing_info`, non-empty prompt) and none of
those clauses check whether the output is *true*. The value delivered is the
blank-page problem, not the send.

Concretely: internal summaries, first-draft outreach where I read before sending,
and restructuring content the transcript already contains.

The scoping decision reinforces this. Execution is deliberately limited to
`EXECUTION_OWNER_ALLOWLIST` (default `Rodrigo Fuentes, Rod`) — not a technical
constraint but a judgment one. Generating drafts for work I'm not accountable for
produces artifacts nobody asked for and nobody will review.

**5. What still needs human judgment**

Two categories showed up on their own, and the classifier caught both without
prompting: **prioritisation and strategy** (HM-0004 and HM-0010 both came back
`Not Automatable` / `Automation not selected by model` — deciding what matters is
the job, and an LLM guess is worse than a blank) and **anything with an external
commitment attached** — pricing, dates, legal terms, client-specific results.
The rubric treats fabricating those as blocking precisely because a confident
wrong number is more damaging than an empty field.

A third category is less obvious and cost real debugging time: **judging whether
the automation itself is behaving.** The batch cap silently stalled on the same 10
rows every pass because a `Missing Info` row never acquires an output link, so it
stayed eligible forever — each pass burning 10 gpt-5 calls to re-derive the same
answer while rows 12–36 sat unreachable. Every individual run logged success.
Noticing that the *aggregate* was wrong needed a human reading the logs and asking
why the numbers never moved.
