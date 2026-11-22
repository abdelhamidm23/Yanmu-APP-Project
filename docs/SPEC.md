# Nursery Command Center — Build Specification v1.0

**Client:** Walid Ibrahim Group (وليد إبراهيم جروب) — Yanmu Pre-School, two branches in Egypt
**Owner contact:** Khaled (not a developer)
**Prepared:** 17 Nov 2026, from the product blueprint and the owner's answers of 16–17 Nov 2026
**Audience:** Claude Code, building the app end to end

> **How to start (for Khaled):** create an empty folder, put this file in it, open Claude Code in that folder and type:
> *"Read NURSERY_COMMAND_CENTER_SPEC.md and start Phase 0."*

---

## 0. Instructions for Claude Code — read first

### 0.1 What you are building
A mobile-first web app (installable PWA) that lets the owner of a two-branch nursery business open their phone, spend 2–5 minutes, and know: is money coming in, are the children here and safe, is the team here, and what needs a decision today. Branch staff enter the data as part of their normal work; the owner enters nothing.

### 0.2 How to work with this owner
- The owner is **not technical**. After every phase, write a short plain-language summary: what was built, how to try it on a phone, and any decision you need. No jargon.
- When the owner must run a command or sign up for something, give exact copy-paste steps and say what they should see.
- **Stop at the end of each phase** (Section 18) and wait for the owner's go-ahead before starting the next.
- Ask before anything that is hard to undo: deleting data, changing the database schema after real data exists, deploying to production, or spending money.
- Never sign up for paid services or enter payment details. The owner creates hosting and SMS accounts; you write the setup steps.
- Where Section 3 lists an open item, **build the stated default and make it a setting** — do not block on it.

### 0.3 Non-negotiable rules (copy these into `CLAUDE.md` in Phase 0)
1. **Missing data is never zero.** Every figure carries a data status (Section 6.1). A value nobody entered shows as "—" with who has not submitted.
2. **Never invent figures.** Demo data exists only in demo mode, flagged everywhere (Section 16).
3. **Permissions are enforced on the server and in the database** (PostgreSQL row-level security), never only by hiding buttons.
4. **Branch isolation:** a user sees only branches they hold a role in. Tested automatically on every change.
5. **Money is stored as integer piastres** (EGP × 100) in `bigint` columns. No floats for money, ever.
6. **Finance is append-only.** Posted invoices, payments, expenses and credit notes are never edited or deleted; corrections are reversal entries.
7. **Everything is audited:** who, when, before, after — via database triggers into `audit_event`.
8. **Arabic and English from day one**, with full RTL. Use CSS logical properties (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`) — never `left`/`right` for layout.
9. **No child names, health details or personal data in push notifications, SMS, WhatsApp, emails or error-monitoring payloads.** Those routes may leave Egypt.
10. **All personal data stays on servers in Egypt** (Section 15). Do not add any third-party service that stores personal data abroad without asking.
11. Times stored in UTC, shown in `Africa/Cairo`.
12. Touch targets ≥ 44 px; text contrast ≥ 4.5:1.
13. Every list can be exported to Excel; every import has preview, row-level errors and one-step rollback.

### 0.4 Definition of done for any feature
- Works in Arabic (RTL) and English on a 390 px-wide phone and on desktop.
- Server-side permission check + RLS policy + automated test proving another branch cannot read or write it.
- Audit entries are written.
- Loading, empty, error and "not submitted" states are designed, not blank.
- Unit tests for any calculation; one end-to-end test for the main flow.

---

## 1. Product summary

| Item | Detail |
| --- | --- |
| Users | Owner, company manager, 2 branch managers, accountant, HR, front desk, teachers |
| Branches | 2 at launch; data model supports more |
| Children | 3 months to 4.5 years, under the nursery licence |
| Capacity | Per branch: licensed 100 children, physical room for 200 |
| Currency | EGP only |
| Languages | Arabic (primary for staff) and English; per-user choice |
| Devices | A phone in every class; managers and owner use their own phones; one Hikvision fingerprint device per branch for staff |
| Hosting | In Egypt (Section 15) |

The first release (MVP) covers: students and enrollment, guardians and authorized pickup, child attendance and sign-out, staff attendance import, monthly billing with late fees, payments and receipts, branch cash box, expenses with approvals, incidents with escalation, an issue tracker, the daily close, the month close, alerts, the owner dashboard, branch comparison, and Excel import/export.

---

## 2. Confirmed business decisions

| # | Decision (owner, 16–17 Nov 2026) | Build consequence |
| --- | --- | --- |
| D1 | Ages 3 months to 4.5 years, all under the nursery licence | Four age bands (2.1). No KG module. |
| D2 | Host in Egypt; no IT provider | Section 15. |
| D3 | Accountant works in Excel | Month close via Excel template import; Excel exports in the accountant's layout. |
| D4 | Fees are monthly, due by the 5th of each month | Invoices issue on the 1st, due date the 5th. |
| D5 | Late fee: **EGP 500 per working day** after the due date | Section 8.4.4. |
| D6 | No discounts active now; discounts and offers existed before | Discount engine exists, no active rules. |
| D7 | Some older families keep an old price | Legacy price lock per child (8.4.2). |
| D8 | Escalation chain: teacher → branch manager → company manager → owner | Section 10. |
| D9 | **Critical incidents alert everyone at once; everything else goes step by step** | Section 10. |
| D10 | Each **branch (nursery) manager** may spend up to **EGP 20,000** without asking, **unless the spending is unusual** | Section 8.6. |
| D11 | Licensed capacity 100 and physical capacity 200, **per branch** | Occupancy is against 100; enrolling past 100 needs owner approval. |
| D12 | Phone in every class | Daily attendance and sign-out run on class phones. |
| D13 | Hikvision fingerprint device, one per branch | Staff attendance imported from its export (8.3). |

### 2.1 Age bands and staff ratios

| Band (EN) | Suggested Arabic label* | Age range | Staff : children |
| --- | --- | --- | --- |
| Babies | الرُّضّع | 3 to < 12 months | 1 : 3 |
| Toddlers | الدارجون | 12 to < 24 months | 1 : 4 |
| Juniors | البراعم | 24 to < 36 months | 1 : 6 |
| Seniors | الكبار | 36 to 54 months (4.5 years) | 1 : 6 |

\*Arabic labels are editable settings; confirm with the owner.

Rules:
- A child's band comes from date of birth. Enrollment of a child under 3 months is blocked.
- 30 days before a child crosses into the next band, the branch manager gets a "ready to move up" item.
- 60 days before a child reaches 54 months, the branch manager and front desk get a "leaving age" item.
- Classes are assigned a band; a child placed in a class of a different band needs a reason (logged).

---

## 3. Open items — build the default, make it a setting

| # | Question | Default to build |
| --- | --- | --- |
| F7 | Hikvision model; sample attendance export (owner will send) | Generic Excel/CSV import with a column-mapping step saved per branch |
| L1 | Late fee per family or per child? | Per invoice (= per child) |
| L2 | Late-fee cap, and who can waive? | No cap. Company manager or owner can waive with a reason (credit note, logged) |
| A1 | Who approves unusual spending, and spending above EGP 20,000? | Unusual ≤ EGP 20,000 → company manager. > EGP 20,000 → company manager recommends, owner decides |
| A2 | Which expense types are routine for a branch manager? | Food & kitchen, cleaning & hygiene, consumables, learning materials, utilities, small repairs |
| W1 | Working days and weekend; holiday calendar | Working days Sunday–Thursday; holidays entered by the branch manager or company manager |
| R1 | Class list per branch (name, band, capacity) | Entered in setup |
| P1 | Payment methods accepted | Cash, card (POS), bank transfer, InstaPay, mobile wallet |
| H1 | Hosting choice after quotes | Huawei Cloud Cairo region (Section 15) |

---

## 4. Scope

### 4.1 MVP (build now)

| Area | In the MVP |
| --- | --- |
| Foundation | Login, MFA for privileged roles, branches, classes, age bands, academic calendar, roles scoped by branch, audit log, Arabic/English with RTL, settings |
| Students | Child records, guardians, family accounts, authorized pickup, consent records, enrollment, transfer between branches, withdrawal, waitlist, restricted medical/allergy notes, age-band alerts |
| Attendance | Daily attendance on class phones, check-out to an approved adult, staff attendance import from fingerprint export, daily class roster, ratio check |
| Finance | Fee lists with effective dates, legacy price locks, monthly invoice run, late fees, payments and receipts, payment allocation, credit notes, refunds, cash box, expenses with photos, approvals, month close, Excel export |
| Safety | Incidents with severity, critical fan-out alerts, guardian notification record, actions, closure sign-off |
| Operations | Issue tracker (maintenance, equipment, supplies) with priority and due dates |
| Owner | Home dashboard, daily briefing, "Requires your attention", KPI detail screens, branch comparison, Inbox, reports with Excel export |
| Data | Excel/CSV import with preview and rollback, initial migration, demo mode |

### 4.2 Later phases (do not build now; keep the model ready)
- **Phase 2:** HR contracts, documents and expiries, leave balances; payroll register; budgets and targets per branch and month; opening/closing and hygiene checklists; compliance calendar (licence, civil defence, inspections, drills); monthly owner PDF pack; weekly email digest; allergy and medication log; restricted child-protection category; parent complaints log.
- **Phase 3:** admissions pipeline; parent app; inventory; direct Hikvision integration (only if the model supports it); scheduled integrations; AI-written summaries that quote their source figures.

---

## 5. Roles and permissions

Roles: `owner`, `company_manager`, `branch_manager`, `accountant`, `hr`, `front_desk`, `teacher`. A user can hold different roles in different branches (`user_branch_role`). `safeguarding_lead` is a flag on a user.

| Area | Owner | Company mgr | Branch mgr | Accountant | HR | Front desk | Teacher |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Owner dashboard, comparison | F | V | V (own) | V (finance) | — | — | — |
| Children, guardians | V | V | E (own) | V (billing fields) | — | E (own) | V (class) |
| Medical and allergy notes | BG | BG | E (own) | — | — | — | V (class) |
| Child attendance, pickup | V | V | E (own) | — | — | E (own) | E (class) |
| Invoices, payments, receipts | V | V | V (own) | F | — | C (own) | — |
| Credit notes, refunds, late-fee waivers | A | A | R | C | — | — | — |
| Expenses | A | A | C (own) | F | — | — | — |
| Cash box | V | V | E (own) | Reconcile | — | E (own) | — |
| Staff records | V | V | V (own) | V | F | — | Self |
| Salaries | V | — | — | V | E | — | Self |
| Incidents | V + sign-off | F | E (own) | — | — | C | C |
| Issues | V | F | E (own) | — | — | C | C |
| Imports | — | F | Staff attendance (own) | Finance | Staff | — | — |
| Audit log | V | V | — | V (finance) | — | — | — |
| Users, roles, settings | A | F | — | — | — | — | — |

F full · E create and edit · C create only · V view · A approve · R request · BG break-glass (view after typing a reason; logged; listed weekly to the owner) · own = own branch · class = own classroom.

Rules:
- Nobody approves their own request. The person who records a payment cannot void it.
- A user whose end date passes loses access at 00:00 that day.
- Teachers see only their class's children; front desk sees no medical notes.

---

## 6. Core system rules

### 6.1 Data status on every figure

| Status | When | UI |
| --- | --- | --- |
| Verified | Month closed and reconciled by the accountant | Figure + "Verified" chip |
| Provisional | Entered, not yet reconciled | Figure + "Provisional" chip |
| Incomplete | Some expected inputs missing | Figure + coverage, e.g. "11 of 12 classes" |
| Not submitted | No input for the period | "—" + who has not submitted |
| Confirmed zero | Someone recorded "none" in the daily close | 0 + "Confirmed" chip |

A consolidated (All branches) figure takes the **weakest** status of its parts.

### 6.2 Daily close
Each branch confirms its day once (Section 8.9). Until closed, today's zeros are unconfirmed and the day counts as Incomplete.

### 6.3 Comparisons
- Month to date compares with the **same number of working days** last month.
- "Versus target" appears only once targets exist (Phase 2).
- "Versus last year" appears only with 12 months of history; imported history is labelled "Imported".

### 6.4 Freshness
Every dashboard card shows when its data last changed and its coverage (e.g. "Days closed in Nov: 10 of 11").

---

## 7. Data model

PostgreSQL 16. All ids `uuid`. Every operational table has `branch_id` (except organization-level tables), `created_at`, `created_by`, `updated_at`, `updated_by`, and soft delete `deleted_at` where deletion is allowed at all. Money columns are `bigint` piastres. Enums as PostgreSQL enums or check constraints.

### 7.1 Organization
- `organization` (id, name_ar, name_en)
- `branch` (id, org_id, name_ar, name_en, code, licensed_capacity int default 100, physical_capacity int default 200, licence_no, licence_expiry date, timezone default 'Africa/Cairo', is_active)
- `age_band` (id, org_id, key, name_ar, name_en, min_age_months, max_age_months, children_per_staff int, sort)
- `room` (id, branch_id, name_ar, name_en, age_band_id, capacity int, is_active)
- `academic_year` (id, org_id, starts_on, ends_on, label)
- `term` (id, academic_year_id, label, starts_on, ends_on)
- `calendar_day` (branch_id, date, is_working_day, note) — generated from weekly pattern + holidays
- `setting` (org_id, branch_id nullable, key, value jsonb, updated_by, updated_at) — all thresholds in Section 17.3 live here

### 7.2 People and access
- `app_user` (id, full_name, phone, email, locale 'ar'|'en', digits 'arabic'|'latin', mfa_enabled, is_safeguarding_lead, end_date, pin_hash for shared devices)
- `user_branch_role` (user_id, branch_id nullable for org-wide, role)
- `staff` (id, branch_id, user_id nullable, full_name_ar, full_name_en, job_title, is_qualified_carer bool, default_room_id, device_employee_no, start_date, end_date, status)
- `staff_salary` (staff_id, effective_from, gross_piastres, notes) — restricted table
- `family` (id, branch_id, account_no, display_name, notes) — billing account; siblings share one
- `guardian` (id, family_id, full_name, relationship, phone, national_id_last4 optional, photo_attachment_id)
- `student` (id, student_no, full_name_ar, full_name_en, date_of_birth, gender, family_id, photo_attachment_id, status)
- `student_guardian` (student_id, guardian_id, can_pick_up bool, is_primary_contact bool)
- `student_medical` (student_id, allergies text, conditions text, medications text, doctor_contact, updated_by) — restricted table
- `consent_record` (student_id, guardian_id, purpose 'records'|'photos'|'medical'|'other', granted_on, withdrawn_on, form_attachment_id, language 'ar')

### 7.3 Enrollment
- `enrollment` (id, student_id, branch_id, room_id, start_date, end_date, status 'active'|'withdrawn'|'graduated'|'transferred', end_reason, fee_list_id, price_lock_id nullable)
- `waitlist_entry` (id, branch_id, student_name, date_of_birth, guardian_phone, requested_start_month, age_band_id, status, notes)
- A transfer closes the old enrollment (status 'transferred') and opens a new one; `student` is never duplicated.
- Active enrollments per branch may not exceed `branch.licensed_capacity` unless an approved `approval_request` of type `over_capacity` references it.

### 7.4 Attendance
- `student_attendance` (id, branch_id, room_id, student_id, date, status 'present'|'absent'|'excused', check_in_at, check_out_at, collected_by_guardian_id, recorded_by, client_uuid for offline idempotency)
- `room_roster` (branch_id, room_id, date, staff_id) — who is assigned to which class today; defaults from `staff.default_room_id`
- `staff_punch` (id, branch_id, staff_id nullable, device_employee_no, punched_at, import_batch_id)
- `staff_attendance_day` (branch_id, staff_id, date, first_in, last_out, status 'present'|'absent'|'leave'|'late') — derived nightly and on import
- `ratio_snapshot` (branch_id, room_id, taken_at, children_present, carers_present, required_carers, is_breach)

### 7.5 Finance
- `fee_list` (id, branch_id, name, effective_from, effective_to) and `fee_list_item` (fee_list_id, age_band_id nullable, item_type 'tuition'|'registration'|'transport'|'service', monthly_amount_piastres)
- `price_lock` (id, student_id, item_type, amount_piastres, reason, starts_on, ends_on nullable, approved_by) — legacy prices
- `discount_rule` (id, branch_id, name, type 'percent'|'amount', value, applies_to, starts_on, ends_on, is_active) — none active at launch
- `invoice` (id, branch_id, family_id, student_id, invoice_no, service_month date (first of month), issue_date, due_date, status 'open'|'paid'|'part_paid'|'void', kind 'tuition'|'late_fee'|'other', total_piastres)
- `invoice_line` (invoice_id, item_type, description, quantity, unit_piastres, amount_piastres, source 'fee_list'|'price_lock'|'discount'|'late_fee'|'manual')
- `payment` (id, branch_id, family_id, received_at, method, amount_piastres, receipt_no, cash_session_id nullable, recorded_by, voided_by, void_reason)
- `payment_allocation` (payment_id, invoice_id, amount_piastres)
- `credit_note` (id, branch_id, invoice_id, amount_piastres, reason, kind 'correction'|'refund'|'waiver', approval_request_id)
- `receipt_sequence` (branch_id, year, next_no) — gap-free per branch per year
- `expense_category` (id, org_id, key, name_ar, name_en, is_routine_default bool)
- `branch_routine_category` (branch_id, expense_category_id)
- `vendor` (id, org_id, name, phone)
- `expense` (id, branch_id, category_id, vendor_id, spent_on, amount_piastres, payment_method, description, receipt_attachment_id, status 'recorded'|'pending_approval'|'approved'|'rejected'|'reversed', is_unusual bool, unusual_reason, approval_request_id, cash_session_id nullable)
- `cash_session` (id, branch_id, date, opened_by, opening_float_piastres, counted_piastres, handed_over_piastres, handed_to, closed_at, variance_piastres)
- `period_close` (branch_id, month, status 'open'|'closed', closed_by, closed_at, reopened_by, reopen_reason)
- `period_import_line` (period_close_id, category_id, amount_piastres, note) — accountant's month-close lines (salaries, rent, central costs)
- `balance_snapshot` (branch_id nullable, month, cash_piastres, bank_piastres, entered_by)

### 7.6 Safety and operations
- `incident` (id, branch_id, room_id, occurred_at, category, severity 'minor'|'moderate'|'serious'|'critical', description, immediate_action, reported_by, guardian_notified_at, guardian_notified_by, guardian_notification_note, status 'open'|'under_review'|'closed', closed_by, closed_at)
- `incident_person` (incident_id, student_id nullable, staff_id nullable, role 'injured'|'involved'|'witness')
- `incident_action` (id, incident_id, description, owner_user_id, due_on, done_at)
- `issue` (id, branch_id, category, title, priority 'low'|'normal'|'high'|'urgent', assigned_to, due_on, status, resolved_at)

### 7.7 Platform
- `approval_request` (id, branch_id, type 'expense'|'credit_note'|'refund'|'late_fee_waiver'|'over_capacity'|'price_lock'|'period_reopen', subject_table, subject_id, amount_piastres, requested_by, status, current_step)
- `approval_step` (request_id, step_no, approver_role, approver_user_id, decision 'approve'|'reject'|'recommend'|'question', comment, decided_at)
- `alert_rule` (key, tier, enabled, threshold jsonb, recipients jsonb, escalate_after_minutes)
- `notification` (id, user_id, alert_key, subject_table, subject_id, title, body, channel, sent_at, read_at, acknowledged_at)
- `daily_close` (branch_id, date, closed_by, closed_at, sections jsonb, notes)
- `attachment` (id, branch_id, bucket_key, mime, size, uploaded_by) — files in object storage, served via short-lived signed URLs
- `import_batch` (id, branch_id, kind, file_attachment_id, status 'preview'|'committed'|'rolled_back', row_count, error_count, committed_by) and `import_error` (batch_id, row_no, column, message)
- `audit_event` (id, at, actor_user_id, table_name, row_id, action, before jsonb, after jsonb, reason)
- `kpi_daily_snapshot` (branch_id, date, kpi_key, value numeric, status)

---

## 8. Modules and workflows

### 8.1 Students and enrollment
- **Add child:** child details → family (existing or new) → guardians and who may pick up (photo optional) → consent forms (Arabic; upload signed scan) → class and start date → fee list (or price lock).
- **Duplicate check:** same name + date of birth, or same guardian phone → prompt before saving.
- **Consent:** written guardian consent is required per purpose; a child without a "records" consent shows a red flag on the child page and in the branch manager's Today list.
- **Transfer:** branch manager of the receiving branch accepts; old enrollment closes, new opens, history stays.
- **Withdrawal:** reason, last day; refund of unused days is a credit note needing approval.
- **Licence cap:** if active enrollments would exceed 100 in that branch, the save becomes an `over_capacity` approval request to the owner.
- **Waitlist:** by age band and requested month; converting a waitlist entry pre-fills Add child.

### 8.2 Child attendance and pickup (class phones)
- **Daily attendance (was "roll call"):** class list with large tap targets; default "not yet marked"; one tap present / absent; "excused" with reason. Works offline (queue in IndexedDB, `client_uuid` idempotency).
- **Check-out:** tap child → choose from approved pickup adults (photos shown) → confirm. An adult not on the list triggers: "Not approved — call the branch manager" and a same-day alert; never a silent release.
- **QR pickup (owner, review of phases 0–3): not in this app for now.** Parents already use a separate app that gives each child a new pickup code every day, shown to the admin team at pickup. Check-out here stays by the approved-adults list.
- **Hours (owner, review of phases 0–3):** Sunday to Thursday, 8 AM to 4 PM, then an after-school hour for late pickups (settings `attendance.opening_time`, `attendance.closing_time`, `attendance.after_school_minutes`). Children still checked in after the after-school time (5 PM) → alert to branch manager.

### 8.3 Staff attendance (Hikvision import) and ratios
- Branch manager uploads the device export (Excel/CSV) at the daily close. First upload: map columns (employee no, name, date-time, device) and save the mapping per branch.
- Punches link to staff via `device_employee_no`; unknown numbers listed for mapping.
- Derive per day: first in, last out, late (after shift start + grace), absent (scheduled, no punch, no approved leave).
- The device model and a sample file are pending (F7). Hikvision terminals usually export attendance records to Excel through the device or Hikvision's PC software; confirm against the owner's sample before finalising the parser. A direct device connection is Phase 3 and only if the model supports it.
- **Ratio check:** for each class, `required_carers = ceil(children_present / children_per_staff)` using the class's age band; `carers_present` = qualified carers on today's `room_roster` (manager adjusts the roster on the Today screen; a manual "present" tap is the fallback before the fingerprint upload). Snapshot at 10:00 and whenever attendance or the roster changes. Breach = `carers_present < required_carers`.

### 8.4 Billing

#### 8.4.1 Monthly invoice run
- Runs on the 1st of each month at 06:00 (job), one tuition invoice per active child, `service_month` = that month, `due_date` = the 5th.
- Lines come from the child's active `price_lock` if any, else the `fee_list` valid on the 1st for the child's band, plus service items (transport etc.), minus active discount rules (none at launch).
- Children starting mid-month: pro-rated by working days (setting `billing.prorate_new_starts`, default on).
- The accountant can review the run in a preview before it posts (default: auto-post, preview available until 09:00).

#### 8.4.2 Legacy price locks
A child can keep an older price: `price_lock` with amount, reason and optional end date, created by company manager or owner (approval logged). Price locks show on the child page and in a "Legacy prices" report.

#### 8.4.3 Payments, receipts, allocation
- Front desk records payment: family → amount → method → allocate (default: oldest open tuition first, then late fees) → numbered receipt.
- Receipt: Arabic/English PDF; print, or share through the phone's share sheet (no WhatsApp API).
- Voids need a reason and a second user; voids are reversal entries.

#### 8.4.4 Late fees (D5)
- From the first **working day** after the due date, a tuition invoice with any unpaid balance accrues **EGP 500 per working day** (`late_fee.daily_piastres = 50000`).
- A nightly job (00:30) adds one line per working day to a separate `late_fee` invoice for that child and service month (`kind = 'late_fee'`, due immediately). Accrual stops the day the tuition balance reaches zero.
- Basis per child (L1 default) — setting `late_fee.basis = 'per_invoice' | 'per_family'`. Cap (L2) — setting `late_fee.cap_piastres = null`.
- Waivers: credit note of kind 'waiver' with reason; approval by company manager or owner.
- Late fees are **other income**: excluded from tuition revenue, collection rate and overdue tuition; shown separately everywhere.
- Families get no automatic message from the app in the MVP; the front desk sees a "late fees today" list.

#### 8.4.5 Credit notes and refunds
Corrections, refunds and waivers are credit notes with approval (Section 8.6 routing applies by amount, minimum one approver).

### 8.5 Cash box
- Front desk opens the day with the float, cash payments and cash expenses attach to the session, front desk counts at close, records the handover (to whom, amount).
- `variance = opening float + cash in − cash out − handed over − counted`; any variance above EGP 200 (setting) alerts the branch manager and company manager.

### 8.6 Expenses and approvals (D10)
- Branch manager records an expense: category, amount, vendor, date, method, receipt photo (required at or above EGP 100, setting).
- **Routine** = category is on the branch's routine list (A2 default) **and** the amount is ≤ 2 × that category's average single expense over the last 3 months (setting; skipped when fewer than 3 months of history) **and** the amount ≤ EGP 20,000. Routine expenses get status `recorded` and count immediately — no approval.
- **Unusual** = anything else under EGP 20,000 → approval request to the company manager.
- **Above EGP 20,000** → company manager recommends (approve / reject / question), then owner decides.
- The branch manager should request before spending on unusual items; the request can later be completed with the actual receipt.
- Approvers act from the Inbox: approve, reject, or ask a question. Rejections stay visible. Nobody approves their own request.

### 8.7 Incidents
- **Short form (≤ 4 fields, offline-capable):** child(ren), class, what happened, action taken; severity picked from fixed definitions. Critical = medical care beyond first aid, any head injury, allergic reaction, child unaccounted for, pickup attempt by an unapproved adult, child-protection concern, or a hazard that closes a class.
- Staff act first (first aid, ambulance 123, call the guardian), then log within 15 minutes.
- Guardian notification recorded: who, when, what was said.
- Full report within 24 hours: people involved, witnesses, photos, corrective actions with owners and due dates.
- Company manager reviews; the **owner signs off closure of every critical incident**.

### 8.8 Issues
Anyone creates (title, category, photo optional, priority); branch manager assigns and sets a due date; overdue issues feed "Overdue actions".

### 8.9 Daily close (branch manager, due 19:00)
1. At 17:00 a prompt opens the day assembled from records: children attendance, pickups, staff (fingerprint upload), payments and cash, expenses, incidents, issues.
2. Each section needs one tap: "Correct" or "Fix". Empty sections ask explicitly, e.g. "No incidents today?" → "Yes, none" records a confirmed zero.
3. Optional notes for management → submit. The day becomes complete.
4. Not closed by 21:00 → alert to company manager; appears in the owner's next briefing as "not closed".
5. A past day can be closed late; it records the late time.

### 8.10 Month close (accountant, by the 7th of next month)
- Accountant downloads the month's Excel pack (invoices, payments, expenses, cash sessions, credit notes) per branch.
- Accountant uploads the month-close template: central costs not recorded in the app (salaries, rent, security, marketing staff, utilities paid centrally, other), reconciled cash and bank balances, and any adjustments.
- The app shows differences between the app's figures and the accountant's; each difference needs a note.
- Accountant closes the month → figures for that month become **Verified**. Reopening needs owner approval and is logged.
- Expense categories align with the owner workbooks: Salaries & benefits, Security, Marketing (incl. marketing staff), Rent, Utilities, Food & kitchen, Cleaning & hygiene, Learning materials, Maintenance & repairs, Transportation, Administrative, Other.

### 8.11 Imports and initial migration
- Every import: download template → upload → preview with row errors in plain words → fix → commit as one batch → rollback available.
- Migration order: branches and classes → fee lists → families, guardians, children → current enrollments and price locks → opening balances per family (signed off by the accountant) → staff with device employee numbers → past monthly finance totals from the owner workbooks (labelled Imported).

---

## 9. KPI definitions

All KPIs are SQL views over source tables (no typed-in numbers), filterable by branch, with a data status.

### 9.1 Money
| KPI | Formula |
| --- | --- |
| Revenue, this month (billed) | Sum of tuition and service invoice lines for `service_month` = this month, minus credit notes against them; excludes late fees |
| Collected, month to date | Sum of payments received this month (shown split: tuition / late fees / other) |
| Collection rate, term to date | Tuition paid against invoices due by today ÷ tuition invoiced and due by today, within the current term |
| Overdue tuition | Unpaid tuition balance on invoices past due date; count of families; aged 1–30, 31–60, 60+ days |
| Late fees outstanding | Unpaid late-fee invoices (separate figure) |
| Operating expenses | Expenses dated in the month (status recorded/approved) + month-close import lines |
| Operating result | Revenue − operating expenses; shown for the last closed month (Verified) and current month (Provisional, Incomplete until payroll lines exist) |
| Cash box variance | Per Section 8.5; target 0 |
| Reconciled cash and bank | From `balance_snapshot`, with its date |

### 9.2 Children
| KPI | Formula |
| --- | --- |
| Active children | Enrollments with status active on the date |
| Occupancy | Active children ÷ licensed capacity (100 per branch); physical capacity (200) shown beside it |
| Net enrollment, month | New starts − withdrawals; graduations shown apart |
| Attendance today | Children present ÷ children expected (active, scheduled weekday, not excused); coverage = classes with attendance taken ÷ classes |
| Retention, term | Children active at term start still active at term end ÷ children active at term start (graduations excluded) |
| Waitlist | Entries waiting, by age band and requested month |
| Moving up / leaving soon | Children crossing a band within 30 days; reaching 4.5 within 60 days |

### 9.3 Team
| KPI | Formula |
| --- | --- |
| Staff present today | Staff present ÷ staff scheduled |
| Ratio breaches today | Classes with `carers_present < ceil(children_present ÷ ratio)` at the 10:00 snapshot or later |
| Absenteeism, 30 days | Unplanned absence days ÷ scheduled days |
| Turnover, 12 months | Leavers ÷ average headcount |

### 9.4 Safety and operations
| KPI | Formula |
| --- | --- |
| Open critical incidents | Severity critical, not closed |
| Incident rate | Incidents in month ÷ average active children × 100 |
| Needs your decision | Approvals waiting for the viewer + overdue actions owned by the viewer |
| Overdue actions | Incident actions and issues past due, not done |
| Daily close rate | Branch-days closed ÷ working branch-days in the month |

### 9.5 Branch comparison (normalized)
Revenue per active child · operating cost per active child · result per child · staff cost ratio (salaries ÷ revenue, closed months only) · collection rate · occupancy · incident rate · overdue tuition per active child · break-even occupancy:

`break_even_occupancy = fixed_monthly_costs ÷ ((avg_net_fee_per_child − variable_cost_per_child) × licensed_capacity)`

### 9.6 "Requires your attention" (owner)
Ranked by severity, then age; max 4 rows on Home, rest in Inbox. Each row has one action button.
1. Open critical incident (always first until the owner has seen it)
2. Approval waiting for the owner (above EGP 20,000, over-capacity, period reopen)
3. A family overdue more than 60 days (setting) or above an EGP threshold (setting, default EGP 15,000)
4. Ratio breach today; daily close missing at 21:00
5. An expense category 20% above its 3-month average for the month
6. Occupancy down 5 points or more month on month
7. Cash box variance above threshold

### 9.7 Daily briefing (template sentences, never free text)
Built from today's data with fixed templates, per branch or consolidated. Each sentence has a "not submitted" variant. Examples:
- `Attendance is {pct}% ({present} of {expected} expected); {missing_rooms} has not taken today's attendance.`
- `No incidents logged today — not confirmed until the {close_time} close.` / `No incidents today (confirmed).`
- `{n} critical incident(s) open; waiting for your review.`
- `EGP {collected} collected this month; {families} families are overdue.`
- `{n} staff absent.` / `Staff attendance not uploaded yet.`
- `{branch} has not closed {date}.`
Arabic templates written separately (not machine-translated at runtime), feminine/masculine forms handled.

---

## 10. Alerts and notifications

| Tier | Examples | Channel | Recipients and escalation |
| --- | --- | --- | --- |
| **Critical — now** | Critical incident; child unaccounted for; pickup attempt by unapproved adult | In-app + push + SMS, repeating every 5 min until **one** person acknowledges | **Everyone at once:** teacher who logged it, branch manager, company manager, owner, safeguarding lead |
| Same day | Ratio breach; child still checked in after closing; cash variance; unusual expense request; daily close missing | In-app + push | **Step by step:** branch manager → company manager after 30 min → owner after 2 h if still unhandled (settings) |
| Daily digest 19:30 | New overdue families, new issues, children moving up / leaving soon | One push | Owner, company manager |
| Weekly, Sunday | Trends, actions overdue > 7 days | Email (Phase 2) | Owner |

- Non-critical incidents: teacher logs → branch manager; not reviewed in 24 h → company manager.
- Quiet hours 22:00–07:00 for everything except Critical.
- Acknowledging a critical alert stops the repeats for everyone and shows who acknowledged and when; it does not close the incident.
- **Message content carries no personal data:** e.g. "Critical incident at Branch B — open the app". Details only inside the app after login.
- SMS provider: choose an Egypt-based provider (owner signs up); abstract behind a `Notifier` interface so WhatsApp Business can be added later.
- iPhone push requires the app added to the home screen; onboarding walks staff through it, and Critical always also goes by SMS.

---

## 11. Screens and navigation

### 11.1 Bottom navigation by role (sidebar on desktop)
| Role | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| Owner | Home | Branches | Inbox (badge) | Reports | More |
| Company manager | Home | Branches | Inbox | Issues | More |
| Branch manager | Today | Children | + Add | Issues | More |
| Accountant | Money | Invoices | + Add | Month close | More |
| Front desk | Today | Children | + Payment | Cash box | More |
| Teacher | My class | Daily attendance | + Incident | More | — |

"+ Add" sheet: Payment, Expense, Incident, Issue, Child, Daily attendance — filtered by permission.

### 11.2 Owner Home (matches the concept mockup)
Top to bottom:
1. Date/time and greeting; "Demo data" pill only in demo mode.
2. Branch switcher: segmented control **All branches | Branch A | Branch B** (names from settings). Every figure, the briefing and the attention list switch.
3. Freshness line: "Updated 16:38 · Days closed in Nov: A 11 of 11, B 10 of 11".
4. **Today at a glance** — navy card with the template briefing and "Written from today's records only. Nothing is estimated."
5. **Requires your attention** — count badge, up to 4 rows (chip with type, meta "Branch B · 11:20", title, detail, action button; critical row uses a filled red button), "See N more in Inbox".
6. Four KPI groups as 2-column tiles: **Money** (Revenue billed · Collected MTD · Collection rate · Overdue tuition [tappable] · Operating result last closed month, full width), **Children** (Active · Occupancy · Attendance today · Waitlist), **Team** (Staff present · Ratio breaches), **Safety and operations** (Open critical · Incidents this month · Approvals waiting · Overdue actions).
7. Legend card explaining the status chips.
Each tile: label, unit (EGP) + value in tabular figures, one-line context, optional status chip. Tap → KPI detail.

### 11.3 KPI detail (example: Overdue tuition)
Back to Home · title + status chip + "as of" · big total + families · ageing bars (1–30 / 31–60 / 60+) with amounts and family counts · by-branch table with per-active-child normalization (highest highlighted) · longest-overdue accounts (account no., branch, number of invoices, amount, days) · actions: "Ask branches to call these families" (creates follow-up tasks), "Export to Excel" · formula footnote.
Every KPI detail follows the same pattern: 12-month trend, split by branch, records behind the number, formula.

### 11.4 Branch comparison
Side-by-side table of normalized metrics (9.5) with the better branch marked; month selector; trend sparkline per metric.

### 11.5 Inbox
Unified list: approvals, critical incidents to review or sign off, follow-ups. Filters: Needs me / All. Approve, reject, recommend, ask, assign, acknowledge without leaving the list.

### 11.6 Branch manager — Today
Attendance by class (roll-call status), today's roster and ratio status per class, staff upload status, payments today, open incidents/issues, children moving up or leaving soon, consent flags, and the "Close the day" button (Section 8.9). The concept mockup shows the close-day screen: progress "5 of 7 checked", checked sections, "Incidents — Needs an answer — Yes, none / Log one", notes, submit button disabled until all sections answered.

### 11.7 Teacher — My class
Class children with photos and allergy icon (details on tap), daily attendance, check-out flow, incident short form.

### 11.8 More / Settings (owner, company manager)
Users and roles · branches, classes, capacities · age bands and ratios · academic calendar and working days · fee lists and price locks · discount rules · expense categories and routine lists · approval limits and unusual-spending rules · alert rules and recipients · late-fee settings · imports · audit log · language · profile.

---

## 12. Design system

Follow the concept mockups ("Owner Dashboard Concept"): minimal, neutral, premium; colour used for status only.

### 12.1 Colour tokens
| Token | Hex | Use |
| --- | --- | --- |
| `bg` | #F6F5F2 | App background |
| `surface` | #FFFFFF | Cards, tiles |
| `border` | #E6E3DD | Card borders |
| `divider` | #EFEDE8 | Row dividers, bar tracks |
| `segment-bg` | #EAE8E3 | Segmented control track |
| `ink` | #1A2230 | Primary text |
| `muted` | #5B6472 | Secondary text |
| `subtle` | #4A5361 | Legend text, provisional chip text |
| `outline` | #C9CFD8 | Input and secondary-button borders |
| `brand` | #1F3A5F | Navy: primary buttons, selected segment, briefing card, links |
| `brand-hover` | #152A47 | Hover/pressed |
| `brand-on-dark` | #C9D4E3 | Secondary text on navy |
| `brand-tint` | #E9EEF5 | Normal-priority chips |
| `good` | #0F766E | Positive values, success button |
| `verified-bg` / `verified-fg` | #E3F1EE / #0F5E57 | Verified and Confirmed chips |
| `attention` | #B3401F | Coral: needs attention values, badges |
| `attention-bg` | #FBEBE5 | High-priority chips |
| `attention-border` | #E3A48C | Unanswered daily-close section |
| `critical` | #A61B1B | Critical values and buttons |
| `critical-bg` | #FBE7E7 | Critical chips |
| `provisional-bg` | #EDEFF2 | Provisional chip |
| `incomplete-bg` / `incomplete-fg` | #E6ECF5 / #2F4A6E | Incomplete chip |
| `chart-neutral` | #8FA3BF | Neutral bars |
No gold. No gradients, no shadows beyond a 1 px border.

### 12.2 Type
- **IBM Plex Sans** (Latin) and **IBM Plex Sans Arabic**, weights 400/500/600; self-host the font files (no Google Fonts call at runtime).
- Sizes: page title 26/600 · section title 17/600 · row title 15/600 · body 13–15 · meta 12–12.5 · KPI value 26/600 (detail hero 38/600) · nav label 11.5–12.
- `font-variant-numeric: tabular-nums` on all figures. Per-user choice of Arabic-Indic or Latin digits.
- Arabic line height ≥ 1.5 for body text.

### 12.3 Shape and spacing
Radius: 16 cards/sections, 14 tiles, 12 buttons and segmented track, 9 segment, 6 chips, pill 999. Spacing scale 4 / 8 / 10 / 12 / 14 / 16 / 20 / 24. Screen padding 16. Touch targets ≥ 44 (primary buttons 48–52).

### 12.4 Components
Branch switcher (segmented, `aria-pressed`) · Briefing card · Attention row · KPI tile (button or link) · Status chip · Section header with period · Ageing bar · Daily-close section card (checked / needs answer) · Primary (navy), success (teal), secondary (outline), danger (red) buttons · Bottom nav with badge · Empty / loading / not-submitted states · Toast · Confirm dialog for irreversible actions.
Use real `<button>`, `<a>`, `<label>`; icon-only buttons have `aria-label`; charts have text alternatives.

---

## 13. Technical architecture

| Layer | Choice |
| --- | --- |
| App | Next.js (App Router) + TypeScript, installable PWA |
| UI | Tailwind CSS with logical properties; Radix UI primitives |
| i18n | next-intl; Arabic and English message files; RTL by `dir` on `<html>` |
| Database | PostgreSQL 16, row-level security; Drizzle ORM and SQL migrations |
| Auth | A maintained library with database sessions and TOTP MFA (e.g. Better Auth or Auth.js); per-person PIN on shared class phones |
| Jobs | pg-boss (Postgres-backed): invoice run, late fees, snapshots, alerts, escalation timers, imports, PDFs |
| Files | S3-compatible object storage (Huawei OBS on Huawei Cloud, or MinIO on a VPS) |
| Offline | Service worker + IndexedDB queue for daily attendance, check-out and the incident short form |
| Charts | Recharts |
| Excel | ExcelJS (import and export) |
| PDF | HTML rendered by headless Chromium (Playwright) — Arabic shaping must be correct |
| Notifications | Web Push (VAPID) + SMS provider behind a `Notifier` interface |
| Tests | Vitest (unit), Playwright (end-to-end), SQL tests for RLS policies, axe for accessibility |
| Errors and logs | Self-hosted error tracking (e.g. GlitchTip) or scrubbed logs only — no personal data to services abroad |
| Packaging | Docker Compose: app, worker, Postgres (dev/VPS only), Caddy for TLS |

### 13.1 Row-level security pattern
- The app connects as a non-owner DB role. Each request runs in a transaction that sets `app.user_id` and the user's permitted branch ids via `SET LOCAL`.
- Policies: `branch_id = ANY(current_setting('app.branch_ids')::uuid[])`; restricted tables (`student_medical`, `staff_salary`) additionally check permission flags; break-glass reads write an audit row with the typed reason.
- Write a test suite that logs in as each role in Branch A and proves it cannot read or write Branch B rows.

### 13.2 Audit
Generic trigger on all business tables writes `audit_event` with before/after JSONB and the actor from `current_setting('app.user_id')`.

---

## 14. Security, privacy and Egyptian compliance

This is a product checklist, not legal advice; the owner should have Egyptian counsel confirm it.

- Egypt's Personal Data Protection Law (Law 151/2020) executive regulations took effect 1 Nov 2025 with a one-year grace period. Implications built into the product:
  - Written guardian consent in Arabic for children's data, per purpose, with withdrawal tracked (`consent_record`).
  - Arabic privacy notice shown at enrollment.
  - Data stays in Egypt (hosting choice); no personal data in messages routed abroad.
  - Exportable data inventory and retention settings (records of processing support).
  - Breach runbook in the handover pack; audit log to establish what was accessed (regulator notice within 72 hours).
- Business tasks outside the app (owner): controller licence from the Personal Data Protection Centre, a registered data protection officer, and the Ministry of Social Solidarity nursery licence renewals (track licence numbers and expiry in `branch`).
- Controls: MFA for owner, company manager, accountant, HR; sessions 12 h on personal phones, 30 min idle on shared class phones; encryption in transit (TLS) and at rest; private object storage with short-lived links; daily backups with point-in-time recovery; quarterly restore test, recorded; rate limiting on login; input validation everywhere.
- Retention defaults (to confirm with counsel): child records anonymized after the retention period; finance kept for tax periods; audit log 5 years.

---

## 15. Hosting and deployment (Egypt)

### 15.1 Recommendation
**Huawei Cloud, Cairo region** (in Telecom Egypt's Tier III data centre at Smart Village): one app server (ECS, ~4 vCPU / 8 GB to start), managed **RDS for PostgreSQL** with automatic backups, **OBS** object storage. Managed database = backups and recovery handled by the provider, which matters because the owner has no IT team. Billed monthly in USD; the owner gets a quote (rough estimate USD 100–180/month for this size — confirm).

**Budget alternative:** an Egyptian VPS (e.g. Link Datacenter, plans from EGP 329/month; this app needs ~4 GB RAM). Everything (app, Postgres, MinIO) runs in Docker Compose on one server; backups, updates and monitoring are then the owner's responsibility (freelancer retainer).

### 15.2 What to deliver for deployment (Phase 8)
- `docker-compose.prod.yml` and an `.env.example` with every variable documented.
- Scripts: first-time server setup, deploy, rollback, database backup to a second location inside Egypt, restore, and a restore-test checklist.
- Health check endpoint and uptime monitoring instructions.
- A runbook in Arabic and English for a freelance DevOps engineer: setup, monthly updates, backup checks, incident response.
- Two environments: **staging** (demo data) and **production** (real data). Never put real children's data in staging.

---

## 16. Demo data

- `pnpm seed:demo` creates two branches (Branch A, Branch B), classes by band, ~150 children, staff, three months of invoices and payments, incidents and issues — all flagged `is_demo`. `pnpm seed:wipe-demo` removes them.
- In demo mode a "Demo data" pill shows on every screen.
- Make the seed reproduce the concept's figures so the screens can be compared:

| Figure | All | Branch A | Branch B |
| --- | --- | --- | --- |
| Active children / licensed | 153 / 200 (77%) | 92 / 100 (92%) | 61 / 100 (61%) |
| Attendance today | 125 of 137 (91%), 12 of 14 classes | 82 of 89 (92%), 6 of 6 classes | 43 of 48 (90%), 6 of 8 classes |
| Nov billed (EGP) | 663.4K | 431.6K | 231.8K |
| Collected MTD (EGP) | 524.2K | 352.9K | 171.3K |
| Collection rate, term | 88% | 90% | 84% |
| Overdue tuition (EGP) / families | 203.6K / 51 | 124.7K / 29 | 78.9K / 22 |
| Overdue 1–30 / 31–60 / 60+ (EGP) | 98.3K / 31.5K / 73.8K | — | — |
| Oct result (Verified) | +62.4K (655.3K − 592.9K) | +77.7K (428.9K − 351.2K) | −15.3K (226.4K − 241.7K) |
| Staff present | 39 / 43 | 24 / 26 | 15 / 17 |
| Ratio breaches today | 1 | 0 | 1 (Toddlers, 1:6 vs required 1:4) |
| Incidents Nov / rate | 6 / 3.9 per 100 | 2 / 2.2 | 4 / 6.6 |
| Open critical incidents | 1 | 0 | 1 |
| Waitlist | 9 | 9 (Toddlers 6, Babies 3) | 0 |

---

## 17. Testing and acceptance

### 17.1 Required automated tests
- Money: invoice run (fee list, price lock, pro-rating), late-fee accrual across weekends and holidays, payment allocation, credit notes, cash variance — exact piastre results.
- KPIs: each formula against a fixture with known answers, including "not submitted" and "confirmed zero".
- RLS: every role × every table × other branch → denied.
- Workflows (Playwright): add child → daily attendance → check-out; payment → receipt; unusual expense → approval chain; critical incident → fan-out → acknowledge → owner sign-off; daily close; month close import.
- Imports: malformed rows, duplicates, rollback.
- Arabic RTL visual snapshots of Home, Today, daily attendance, payment.

### 17.2 Go-live gate (pilot at one branch, then both)
1. The branch closes its day on ≥ 90% of working days for 2 weeks.
2. One month of tuition and expenses matches the accountant's Excel within 1%, every difference explained.
3. Permission tests pass: no role reads another branch's data or restricted fields.
4. A test critical incident reaches every designated person and is acknowledged within 15 minutes.

### 17.3 Default settings (all editable)
| Key | Default |
| --- | --- |
| billing.invoice_day | 1 |
| billing.due_day | 5 |
| late_fee.daily_piastres | 50000 (EGP 500) |
| late_fee.basis | per_invoice |
| late_fee.cap_piastres | null |
| calendar.working_days | Sun, Mon, Tue, Wed, Thu |
| approvals.branch_manager_limit_piastres | 2000000 (EGP 20,000) |
| approvals.unusual_multiplier | 2.0 (× 3-month category average) |
| expenses.photo_required_from_piastres | 10000 (EGP 100) |
| capacity.licensed / physical | 100 / 200 per branch |
| ratio.snapshot_time | 10:00 |
| daily_close.prompt / due / alert | 17:00 / 19:00 / 21:00 |
| alerts.critical_repeat_minutes | 5 |
| alerts.step_escalation_minutes | 30 (to company manager), 120 (to owner) |
| alerts.quiet_hours | 22:00–07:00 |
| attention.overdue_days / overdue_amount | 60 days / EGP 15,000 |
| cash.variance_alert_piastres | 20000 (EGP 200) |
| age_band.move_up_notice_days / leaving_notice_days | 30 / 60 |

---

## 18. Build plan — stop for owner review after each phase

| Phase | Build | Owner can check |
| --- | --- | --- |
| 0. Setup | Repo, `CLAUDE.md` (rules from 0.3), this spec copied to `docs/SPEC.md`, Docker dev environment, Postgres, auth with MFA, i18n + RTL shell, design tokens, bottom nav shells per role, CI with tests | Log in on a phone in Arabic and English |
| 1. Foundation | Organization, branches, classes, age bands, calendar, users and roles, RLS, audit, settings screen | Create users and classes; see the audit log |
| 2. Children | Families, guardians, children, consent, enrollment, transfer, withdrawal, waitlist, licence cap, age-band alerts, child import | Add and import children; try to exceed 100 |
| 3. Attendance | Daily attendance (offline), check-out to approved adults, roster, Hikvision import with mapping, ratio checks | Take attendance on a class phone; upload a staff file |
| 4. Money | Fee lists, price locks, invoice run, payments, receipts, late fees, credit notes, cash box, expenses, approvals | Run a month; record payments; see late fees accrue |
| 5. Safety & ops | Incidents, critical fan-out, SMS + push, acknowledgement, actions, sign-off; issues; step escalation | Raise a test critical incident |
| 6. Closing | Daily close, month close with Excel template, Excel exports, KPI views, daily snapshots, data status | Close a day; import a month close |
| 7. Owner experience | Home, briefing templates, attention list, KPI details, branch comparison, Inbox, reports | Use Home for 5 minutes with demo data |
| 8. Hardening & handover | Full test suite, security review, performance on a slow phone, deployment scripts, backup/restore, runbooks, user guides (Arabic) per role, demo seed | Staging on the chosen host; pilot starts |

---

## 19. Glossary (UI terms)

| English | Arabic |
| --- | --- |
| Home | الرئيسية |
| Branches | الفروع |
| Inbox | الوارد |
| Reports | التقارير |
| More | المزيد |
| All branches | كل الفروع |
| Today at a glance | ملخص اليوم |
| Requires your attention | يحتاج انتباهك |
| Verified | مُعتمد |
| Provisional | مبدئي |
| Incomplete | غير مكتمل |
| Not submitted | لم يُرسل |
| Confirmed | مؤكَّد |
| Close the day | إغلاق اليوم |
| Daily attendance | الحضور اليومي |
| Overdue tuition | رسوم متأخرة |
| Late fee | غرامة تأخير |
| Occupancy | نسبة الإشغال |
| Critical incident | حادث حرج |
| Approval | موافقة |
| Company manager | مدير الشركة |
| Branch manager | مدير الفرع |
| Demo data | بيانات تجريبية |

*End of specification.*
