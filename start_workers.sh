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

echo "Starting category worker on queue 'category_checks' (single worker only)..."
rq worker category_checks &
pids+=("$!")

echo "Starting $RANK_WORKER_COUNT rank worker(s) on queue 'rank_checks'..."
for i in $(seq 1 "$RANK_WORKER_COUNT"); do
    rq worker rank_checks &
    pids+=("$!")
done

echo "All workers started. Press Ctrl+C to stop them all."
wait
