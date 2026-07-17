# Docker image for running the backend on EC2 (or Render) -- exists
# because a standard buildpack/bare host has no Chrome/Chromium
# installed at all, and scripts/exp_category_pipeline (serp_fetch.py) +
# scripts/intent_classifier.py both need a real Chrome browser (Selenium)
# for the /jobs/category and /projects/{project}/categorize endpoints.
# Nothing about the app's code changes because of this -- this just
# gives it a Linux environment with Chrome actually present.
#
# NON-HEADLESS: serp_fetch.py's get_driver() and intent_classifier.py's
# _new_chrome_driver() both launch Chrome WITHOUT --headless (removed
# deliberately, for visual debugging). That means Chrome needs a display
# to attach to even inside this container -- xvfb (a virtual framebuffer)
# is installed below, and the CMD wraps uvicorn in `xvfb-run` so a
# virtual display exists automatically, with no manual Xorg/VNC setup.
#
# Build + run on EC2 (from the `backend/` directory). Port 80 is left
# for nginx (serving the frontend) -- this maps host 8000 -> container
# 8000, matching what the frontend's CATEGORY_API_BASE already expects:
#   docker build -t seo-backend:latest .
#   docker run -d --name seo-backend --restart unless-stopped \
#     --env-file .env -p 8000:8000 seo-backend:latest
#
# Env vars needed in .env: DATABASE_URL, BRIGHTDATA_API_KEY,
# BRIGHTDATA_SERP_ZONE, OPENAI_API_KEY, OPENAI_CHAT_MODEL,
# ANTHROPIC_API_KEY, ANTHROPIC_CHAT_MODEL, DEFAULT_DOMAIN. Leave
# USE_SELENIUM_PIPELINE UNSET (or explicitly "true") -- this image has
# Chrome, so the Selenium engine should run here, not the Bright Data
# fallback.

FROM python:3.14-slim

# System packages Chrome needs to run at all inside a minimal container
# -- without these, Chrome fails to launch with missing-shared-library
# errors before Selenium even gets a chance to connect to it. xvfb-run
# pulls in xvfb + the wrapper script that starts/stops a virtual display
# automatically around whatever command it wraps.
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    xvfb \
    xauth \
    && rm -rf /var/lib/apt/lists/*

# Google Chrome itself, from Google's own apt repo -- Selenium Manager
# (built into the `selenium` package, no webdriver_manager involved) then
# auto-resolves and downloads the matching chromedriver build at runtime,
# the first time a driver is launched.
RUN wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends /tmp/google-chrome.deb \
    && rm /tmp/google-chrome.deb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1

# $PORT is honored if set (e.g. Render); defaults to 8000 (e.g. EC2).
# xvfb-run -a starts a virtual display on a free display number, runs
# uvicorn against it, and tears the display down when the process exits
# -- Chrome (launched non-headless by serp_fetch.py / intent_classifier.py)
# attaches to that virtual display exactly as it would a real one.
CMD ["sh", "-c", "xvfb-run -a uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}"]
