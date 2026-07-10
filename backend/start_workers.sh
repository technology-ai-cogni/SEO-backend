#!/usr/bin/env bash
# Launches both background workers for local testing.
#
# IMPORTANT: only run ONE category worker at a time -- category assignment
# depends on categories created by prior keywords in sequence, so multiple
# concurrent workers would create duplicate/inconsistent categories.
#
# Rank-checking has NO such restriction -- checking one keyword's rank has
# no bearing on any other keyword's rank, so RANK_WORKER_COUNT below can
# safely be set above 1 to check ranks faster (each one is just another
# consumer pulling from the same 'rank_checks' queue).

# The `rq` CLI does NOT read job_queue.py's dotenv config -- python's
# load_dotenv() only affects environment variables inside a Python
# process that calls it, and `rq worker <queue>` on its own defaults to
# redis://localhost:6379, silently ignoring your actual REDIS_URL. Load
# .env into THIS SHELL directly so $REDIS_URL is available to pass along
# explicitly via --url below.
if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
fi

if [ -z "$REDIS_URL" ]; then
    echo "REDIS_URL is not set (checked .env and the current environment). Aborting."
    exit 1
fi

RANK_WORKER_COUNT="${RANK_WORKER_COUNT:-2}"

pids=()

cleanup() {
    echo ""
    echo "Stopping workers..."
    for pid in "${pids[@]}"; do
        kill "$pid" 2>/dev/null
    done
    wait 2>/dev/null
    exit 0
}
trap cleanup INT TERM

# --worker-class rq.SimpleWorker: the default Worker forks a new process
# per job, which segfaults on macOS when the forked child makes an HTTPS
# call (Bright Data / OpenAI) -- see worker.py's module docstring for the
# full explanation. SimpleWorker runs jobs in-process, no fork, no crash.
echo "Starting category worker on queue 'category_checks' (single worker only)..."
rq worker category_checks --worker-class rq.SimpleWorker --url "$REDIS_URL" &
pids+=("$!")

echo "Starting $RANK_WORKER_COUNT rank worker(s) on queue 'rank_checks'..."
for i in $(seq 1 "$RANK_WORKER_COUNT"); do
    rq worker rank_checks --worker-class rq.SimpleWorker --url "$REDIS_URL" &
    pids+=("$!")
done

echo "All workers started. Press Ctrl+C to stop them all."
wait