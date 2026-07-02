# Keyword Categorizer

Category-only pipeline: uploads a keyword list, fetches the top-3 organic
Google results per keyword (via Bright Data), and uses OpenAI to assign a
short, word-constrained category name -- matching against categories
already created earlier in the run, stored in Postgres.

## Files

- `db.py` — Postgres (Supabase): `jobs`, `categories`, `keyword_categories`
- `job_queue.py` — Redis (Upstash) + the `category_checks` RQ queue
- `app.py` — FastAPI backend, `POST /jobs/category` + status/results endpoints
- `category_checker.py` — the actual scraping + OpenAI logic
- `category_tasks.py` — worker task run by `rq worker category_checks`
- `requirements.txt`, `.env.example`/`.env`, `.gitignore`, `start_workers.sh`

## ⚠️ Worker concurrency

Run only **ONE** `rq worker category_checks` process at a time. Category
assignment is sequential by design -- each decision depends on categories
already created by prior keywords in the run, to avoid creating duplicate
near-identical categories.

## Local setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# fill in DATABASE_URL, REDIS_URL, BRIGHTDATA_API_KEY, BRIGHTDATA_SERP_ZONE, OPENAI_API_KEY

python3 db.py          # one-time: create tables
uvicorn app:app --reload --port 8000     # terminal 1
./start_workers.sh                        # terminal 2
```

```bash
curl http://localhost:8000/health
curl -F "file=@keywords.csv" http://localhost:8000/jobs/category
curl http://localhost:8000/jobs/<job_id>
curl http://localhost:8000/jobs/<job_id>/results
curl http://localhost:8000/jobs/<job_id>/download -o results.csv
```

## Before deploying

- Rotate every credential in `.env` if it was ever pasted anywhere outside your own machine
- Lock down CORS in `app.py`
- Decide on auth before the API is public
