#!/usr/bin/env bash
# Launches the category worker for local testing.
#
# IMPORTANT: only run ONE category worker at a time -- category assignment
# depends on categories created by prior keywords in sequence, so multiple
# concurrent workers would create duplicate/inconsistent categories.

echo "Starting category worker on queue 'category_checks'..."
rq worker category_checks
