# SEO Dashboard (Frontend)

React + Vite dashboard for managing SEO projects: importing keyword sheets,
reviewing auto-generated categories/clusters, checking Google rank, and
tracking pages/competitors. Talks to two backends: **Supabase** directly
(for reading/writing most data) and the **FastAPI backend** in `../backend`
(for anything that needs Bright Data/OpenAI -- categorization and rank
checks).

## Architecture

```
┌─────────────┐       reads/writes           ┌──────────────┐
│   Browser    │ ───────────────────────────► │   Supabase    │
│  (this app)  │      (projects, domains,      │  (Postgres)   │
│              │       keyword_categories)      └──────────────┘
│              │
│              │      POST /jobs/category       ┌──────────────┐
│              │      POST /jobs/{id}/check-rank │   FastAPI    │
│              │ ───────────────────────────────►│   backend     │
└─────────────┘      GET  /jobs/{id}/results     │  (../backend) │
                                                  └──────────────┘
```

- **Supabase client** (`src/lib/supabaseClient.js` + `src/lib/projectsApi.js`)
  handles everything that's just data: project/domain CRUD, reading keyword
  rows, editing/deleting keyword rows. This is the source of truth the UI
  tables render from.
- **Backend API** (hardcoded base URL inside `ProjectSetupPage.jsx`, see
  below) handles the two things that need external APIs: kicking off
  categorization for a freshly uploaded sheet, and triggering a rank check.
  The UI polls the backend for job status, then re-reads the *results* back
  out of Supabase once a job completes -- the backend and Supabase are
  writing to the same `keyword_categories` table.
- **Local mode**: if `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` aren't
  set, `supabaseClient.js` exports `supabase = null` and every function in
  `projectsApi.js` falls back to reading/writing `localStorage` instead --
  useful for UI-only work without a real database, but categorization/rank
  results from the real backend won't show up in this mode since they only
  ever get written to Supabase, never localStorage.

## Folder structure

```
seo-dashboard/
├── index.html
├── vite.config.js
├── package.json
├── datasets/                Sample keyword sheets used for local testing
└── src/
    ├── main.jsx               Entry point
    ├── App.jsx                 Top-level layout/router
    ├── components/
    │   ├── layout/
    │   │   ├── Sidebar.jsx
    │   │   └── Topbar.jsx
    │   ├── pages/               One file per sidebar destination
    │   │   ├── HomePage.jsx
    │   │   ├── DashboardPage.jsx
    │   │   ├── ProjectSetupPage.jsx   Largest page -- Domain/KW Cluster/Pages/
    │   │   │                          Competitors tabs, keyword import, category
    │   │   │                          review table, "Check initial ranking" button
    │   │   ├── KeywordsPage.jsx
    │   │   ├── PositionAnalysisPage.jsx
    │   │   ├── TopPagesPage.jsx
    │   │   ├── CompetitorsPage.jsx
    │   │   ├── AIVisibilityPage.jsx
    │   │   ├── ContentEnginePage.jsx
    │   │   └── PlaceholderPage.jsx
    │   └── ui/
    │       ├── Card.jsx
    │       └── MiniChart.jsx
    ├── data/
    │   ├── navigation.js          Sidebar route definitions
    │   ├── mockData.js             Fallback/demo data
    │   └── csvParser.js
    ├── lib/
    │   ├── supabaseClient.js       Creates the Supabase client (or null -- see Local mode above)
    │   └── projectsApi.js          Every Supabase read/write, plus the localStorage fallback
    └── styles/
        └── global.css
```

## Setup

```bash
cd frontend/seo-dashboard
npm install

cat > .env <<EOF
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
EOF

npm run dev       # http://localhost:5173
```

`.env` is gitignored (never committed) -- the anon/publishable key is
client-safe to expose in the browser bundle, but it still shouldn't sit in
git history. Never put the Supabase `service_role` key here; only the
`anon`/`publishable` one.

## Connecting to the backend

`ProjectSetupPage.jsx` has a hardcoded `CATEGORY_API_BASE` constant near the
top of the file:

```js
const CATEGORY_API_BASE = 'http://localhost:8000';
// Swap to 'https://seo-backend-fqlp.onrender.com' (or your deployed URL) before deploying
```

**Check this before every deploy or local test run** -- it's the single
place that decides whether keyword imports/rank checks hit your local
backend or the deployed one. It is not read from an env var.

## Key data flow: importing keywords

1. User uploads a sheet in `ProjectSetupPage.jsx`'s "Add Keywords" modal.
2. `runCategoryJob()` POSTs the raw file to the backend's `POST /jobs/category`
   -- this is the ONLY step that touches the backend during import; it
   creates/reuses the project and pre-inserts one `keyword_categories` row
   per keyword (category/cluster still null at this point).
3. `pollCategoryJob()` polls `GET /jobs/{job_id}` every few seconds.
4. Once the job's status is `completed`, results are read back via Supabase
   (`fetchKeywordRows`) -- not from the backend's `/results` endpoint -- so
   the table always reflects the real DB state.
5. "Check initial ranking" follows the same pattern against
   `POST /jobs/{job_id}/check-rank`, polling `/results` and re-reading rank
   values from Supabase.

## Build

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build locally
```
