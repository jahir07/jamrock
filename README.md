# WP Jamrock (Under Development 🚧)

**Jamrock** is a modular WordPress plugin that connects **Gravity Forms**, **Psymetrics assessments**, and a custom **Vue 3–powered admin dashboard** to manage recruitment, training, and certification data — all from one unified system.  
⚠️ **Note:** This plugin is still in **active development**. APIs, UI, and database structure may evolve before the first stable release.

---

## ✨ Features (Current)

### 🔹 Recruitment & Applicant Management
- Automatically sync **Gravity Form** submissions into the applicants table.
- View, filter, and paginate all candidates via the **Vue 3 admin panel**.
- Applicant statuses: `applied`, `shortlisted`, `hired`, `active`, `inactive`, `knockout`.

### 🔹 Psymetrics Integration
- Direct connection to **Psymetrics Assessment API**:
  - Automatic assessment registration after Gravity Form submission.
  - Sync completed assessments via REST endpoint (`/assessments/sync`).
  - Store scores, candidness, completion date, and provider info.
- Admin Vue dashboard with filters:
  - Provider (psymetrics, autoproctor, etc.)
  - Candidness (pending, cleared, flagged)
  - Date-range sync + pagination
- Inline **iframe exam launcher** (embedded Psymetrics tests).
  - Auto-iframe confirmation replaces redirect.
  - Fallback to “Open in new tab” when embedded mode not supported.

### 🔹 Announcements & Updates
- Admin panel for adding and pinning manual announcements.
- Automatic announcements for:
  - New posts or course launches.
  - Policy changes or expiring certifications.
- REST API & dashboard block for frontend display.

### 🔹 Dashboard (Frontend)
- Vue-powered **Certification Tracker Dashboard**:
  - Dynamic data from `/wp-json/jamrock/v1/me/dashboard`.
  - Donut chart for training completion.
  - Bar charts for required certifications.
  - Real-time learning hour tracker.
  - Motivational progress messages.
- Fully integrated with LearnDash (or any LMS providing course progress via API).

---

## 🧩 Shortcodes

| Shortcode | Description |
|------------|-------------|
| `[jamrock_form]` | Renders the recruitment form (linked to Gravity Forms). |
| `[jamrock_dashboard]` | Displays the candidate certification dashboard. |
| `[jamrock_announcements]` | Lists latest and pinned announcements. |

---

## 🔨 Gutenberg Blocks

- **Jamrock Form Block** — For embedding job application form.
- **Jamrock Results Block** — For showing submissions.
- **Jamrock Dashboard Block** — For user-facing progress overview.

Each block supports Inspector Controls for titles, filters, and placeholders (coming soon).

---

## 🧠 Admin App (Vue 3)

A modern Vue 3 SPA (Single Page App) runs inside the **Jamrock → Dashboard** menu.  
Modules include:

| Section | Purpose |
|----------|----------|
| **Applicants** | List, search, filter applicants (from Gravity Forms). |
| **Assessments** | View synced Psymetrics results; trigger manual sync by date. |
| **Announcements** | Manage, pin, or auto-generate updates. |
| **Settings** | Add API keys, Gravity Form ID, Psymetrics secrets, etc. |

---

## 🧱 Database Schema

### `wp_jamrock_applicants`
| Column | Type | Description |
|---------|------|-------------|
| id | bigint | Auto ID |
| jamrock_user_id | char(36) | UUID for cross-linking |
| first_name, last_name | varchar | Basic identity |
| email, phone | varchar | Contact |
| status | enum | applied / shortlisted / active / knockout |
| score_total | float | Overall assessment score |
| created_at / updated_at | datetime | Audit columns |

### `wp_jamrock_assessments`
| Column | Type | Description |
|---------|------|-------------|
| id | bigint | Auto ID |
| applicant_id | bigint | FK to applicants |
| provider | varchar(50) | psymetrics / autoproctor |
| external_id | varchar(100) | Psymetrics GUID |
| email | varchar | Candidate email |
| overall_score | float | Result score |
| candidness | enum | cleared / flagged / pending |
| completed_at | datetime | Assessment completion date |

---

## ⚙️ REST API Endpoints

| Endpoint | Method | Description |
|-----------|---------|-------------|
| `/jamrock/v1/applicants` | GET | Paginated applicants list |
| `/jamrock/v1/assessments` | GET | Paginated assessments |
| `/jamrock/v1/assessments/sync` | POST | Fetch from Psymetrics by date |
| `/jamrock/v1/me/dashboard` | GET | Candidate dashboard data |
| `/jamrock/v1/entry/{id}/psymetrics-url` | GET | Poll endpoint for iframe loading |
| `/jamrock/v1/announcements` | GET | Latest & pinned announcements |

---

## 🧩 Gravity Forms Integration

- After form submission (`gform_after_submission_{form_id}`), Jamrock:
  1. Registers candidate via Psymetrics API.
  2. Saves `assessment_url` and redirects or iframes the exam.
- The same form submission creates/updates applicant entry in `jamrock_applicants`.
- Confirmation screen loads exam inside iframe with fallback.

---

## 🧰 Developer Setup

### Requirements
- **WordPress 6.0+**
- **PHP 7.4+**
- **Node 18+ / pnpm 8+**
- **Composer** (for vendor autoloading)

### Setup
```bash
composer install
pnpm install
pnpm run dev       # Start Vite dev server
pnpm run build     # Build admin app + blocks
```

---

## 🧭 Roadmap

- [ ] Webhook receiver for Psymetrics assessment completion.
- [ ] LearnDash progress auto-sync with dashboard metrics.
- [ ] Enhanced block controls & Inspector UI.
- [ ] Export applicants & results (CSV/JSON).
- [ ] Candidate profile & history page.
- [ ] Email notifications for new assessments.
- [ ] API key management UI.
- [ ] PHPUnit + Playwright testing (optional).

---

## 🧑‍💻 Contributors

- **Jahirul Islam Mamun** — Lead Developer
- Designed for **Jamrock Jerk NY** internal recruitment system.
