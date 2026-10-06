# SPEC.md — MU College Timetable Generation

Frozen after Phase-0 discussion. Any constraint change here requires updating this file first, then code.

## Scope (current phase)
Single department (IT) only. Multi-department designed for but not required day 1.

## Entities
- **Division**: e.g. 2nd Year IT — Division A. Has N batches (A1, A2, A3…), count set dynamically by admin per year+division at start of semester.
- **Teacher**: logs in via Google OAuth. Admin assigns subject + year + division after signup. `employment_type`: REGULAR (default) | VISITING (disabled by default, admin-enabled per teacher when needed).
- **Subject**: has theory / practical / tutorial hour breakdown per MU syllabus (admin-entered per subject per division).
- **Room**: dynamic pool, admin assigns available rooms/labs per year+division at start of semester. No hardcoded room data.

## Time grid (fully dynamic, no fixed defaults)
Flow:
1. Admin enters start time, end time (any values, AM/PM).
2. Admin enters lecture/period length in minutes.
3. Admin enters lunch length in minutes.
4. Backend computes all possible slot boundaries from start→end at that period length, returns them as candidate slots.
5. Admin picks ONE candidate slot to be lunch. That slot's clock time + duration become the fixed lunch window for all divisions.
6. Lab = exactly 2 consecutive period-slots (same duration unit as theory, back to back, no gap).

No fixed periods-per-day constant. No fixed end time. Grid is clock-time keyed (`start_time`/`end_time` per slot), not period-index keyed — required because lab blocks (2 slots) and lunch (admin-picked, possibly a different length) break a uniform period-index model.

## Batch / lab rule (core, non-obvious)
When any batch (A1/A2/A3…) of a division has a lab in a given slot, ALL batches of that division have a lab in that same slot (parallel, different subject/lab each) — never a partial split where one batch labs while another sits in division-wide theory. Division-wide theory and batch-parallel-labs are mutually exclusive states per (division, day, slot).

## Elective handling
Not a solver concern. Admin manually assigns each student's chosen elective subject into that student's year+division weekly requirement after collecting choices. Solver treats it as a normal subject row.

## Mini-project / audit courses / mentor sessions
Not scheduled in the timetable at all. Out of scope for the solver entirely.

## Manual edit behavior
Admin can reassign teacher/room on a single generated slot. That slot becomes locked. System detects resulting conflicts (teacher double-booked, room clash) and re-solves ONLY the conflicting/unlocked slots — never a full re-generate, never touches other already-locked manual edits.

## Visiting faculty (placeholder, not active yet)
Fields exist (`available_days`, `available_time_range`) but constraint logic only runs when `employment_type == VISITING`, which defaults off per teacher. Zero effect on REGULAR teacher solving path until explicitly enabled by admin.

## Constraint table (final)

### Hard (must never violate)
| # | Constraint | Notes |
|---|---|---|
| H1 | Teacher no double-booking | across any division/batch, same day+time |
| H2 | Room/lab no double-booking | one room = one class/batch per slot |
| H3 | Lab = exactly 2 consecutive slots | same room, same teacher throughout |
| H4 | Lab room-type match | admin pre-assigns correct room/lab type per subject |
| H5 | Batch tri-parallel rule | all batches of a division lab together, or all in division theory — never mixed |
| H6 | No batch overlap | a batch can't have 2 labs at once |
| H7 | Weekly subject quota exact | theory/practical/tutorial hours per MU syllabus, per division |
| H8 | One lecture per division/batch per slot | no double assignment |
| H9 | Lunch fixed (admin-picked slot) | blocks all divisions simultaneously |
| H10 | Visiting faculty availability | only enforced if `employment_type == VISITING` |
| H11 | Teacher daily lecture cap | project-defined value, not MU-mandated |

### Soft (optimize when feasible)
| # | Constraint |
|---|---|
| S1 | Prefer break after a lecture run |
| S2 | Max 4 consecutive teacher lectures |
| S3 | No consecutive same subject, same division |
| S4 | Subject daily limit = ceil(periods/week ÷ school days) |
| S5 | Workload balance across teachers |
| S6 | Lab morning-preference (optional, admin togglable) |

### Explicitly dropped from reference project
- Class-teacher-period-1 rule — no "class teacher" concept at college level.
- PT ground capacity — no PT subject.
- Saturday half-day handling — Sat/Sun are full holidays, no lecture days at all.

## Solver choice
Google OR-Tools CP-SAT. Rationale in `docs/STACK.md`. Decision variable:
`x[(division, batch_or_none, day, start_time, subject, teacher, room)] = BoolVar`
`batch_or_none` is null for theory (whole division), populated for lab (per batch).

## Non-goals (this phase)
- Multi-department generation (designed for, not required now).
- MU-mandated faculty workload norms (explicitly excluded per stakeholder decision — project-defined cap only).
- Recess/short breaks beyond lunch (none exist).
- Multiple shifts / room-sharing across shifts (single shift only).
