"""
serp_fetch.py -- experimental, standalone

Fetches the top-3 organic Google results (url + title) for a batch of
keywords using a REAL Chrome browser with several tabs open at once,
round-robin -- the exact same approach as scripts/serp_scraper.py's
run_search_pool(), faithfully duplicated here (not imported, per the
zero-import constraint on this experiment) so this pipeline has zero
code dependency on the production scraper.

No Bright Data, no SerpApi, no plain `requests` HTTP call to Google at
all -- this drives one actual Chrome window via Selenium, opens
`NUM_TABS` tabs in it, and round-robins a fresh keyword search into
whichever tab is free, exactly like serp_scraper.py does.

IMPORTANT trade-off vs. the Bright Data version this replaces: because
a single browser session with N tabs is inherently a BATCH operation
(one driver, one round-robin loop over every keyword at once) rather
than something callable independently per keyword, the entry point here
is fetch_top3_batch(keywords) -- it takes the WHOLE keyword list and
returns results for all of them, not one keyword at a time. There is
also no `country_code` override here -- serp_scraper.py's start_search()
doesn't support one either (always `&hl=en`, no `&gl=`); the earlier
Bright Data version's --country flag has no effect on this path.
"""

import csv
import json
import random
import time
import os
import zipfile
import tempfile
from datetime import datetime
from typing import Optional
from urllib.parse import quote_plus

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    TimeoutException, NoSuchElementException, StaleElementReferenceException
)
from selenium.webdriver.chrome.service import Service

NUM_TABS = 8
TAB_TIMEOUT = 50
DELAY_MIN = 5
DELAY_MAX = 12
from scripts.serp_scraper import create_proxy_auth_extension, get_driver, run_search_pool


def accept_consent(driver):
    try:
        btn = WebDriverWait(driver, 5).until(
            EC.element_to_be_clickable(
                (By.XPATH, "//button[.//span[contains(text(),'Accept all')]]")
            )
        )
        btn.click()
        time.sleep(1)
    except TimeoutException:
        pass


def extract_results(driver) -> list:
    anchors = driver.find_elements(By.CSS_SELECTOR, 'a[jsname="UWckNb"]')
    if not anchors:
        anchors = driver.find_elements(By.CSS_SELECTOR, 'div.g a[href]')

    results = []
    for a in anchors:
        try:
            href = a.get_attribute("href")
            if not href:
                continue
            if any(s in href for s in [
                "webcache", "google.com/search", "google.com/url",
                "accounts.google", "javascript:", "#:~:text="
            ]):
                continue
            if not href.startswith("http"):
                continue

            try:
                title = a.find_element(By.TAG_NAME, "h3").text.strip()
            except NoSuchElementException:
                title = ""
            if not title:
                title = (a.get_attribute("aria-label") or "").strip()
            if not title:
                title = a.text.strip()
            if not title:
                continue  # not a real organic result (icon/empty link etc.)

            results.append({"url": href, "title": title})
        except StaleElementReferenceException:
            continue
    return results


def start_search(driver, keyword: str):
    driver.get(f"https://www.google.com/search?q={quote_plus(keyword)}&num=10&hl=en")


def tab_ready(driver) -> bool:
    """Non-blocking check: has this tab's results page rendered yet?
    Used instead of WebDriverWait so checking one tab never blocks the others."""
    return bool(driver.find_elements(By.ID, "search"))


def is_captcha_page(driver) -> bool:
    """Google redirects to /sorry/... or embeds a reCAPTCHA iframe instead
    of real results when it flags this tab's traffic as automated."""
    try:
        if "/sorry/" in driver.current_url:
            return True
    except Exception:
        pass
    return bool(driver.find_elements(
        By.CSS_SELECTOR, "iframe[src*='recaptcha'], form#captcha-form"
    ))


def open_tabs(driver, count: int) -> list:
    handles = driver.window_handles
    while len(handles) < count:
        driver.switch_to.window(handles[-1])
        driver.execute_script("window.open('about:blank', '_blank');")
        handles = driver.window_handles
    return handles[:count]


class TabJob:
    def __init__(self, row: dict):
        self.row = row
        self.start_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.deadline = time.time() + TAB_TIMEOUT
        self.retried = False


def fetch_top3_batch(keywords, num_tabs: int = NUM_TABS, on_result=None):
    """The entry point run_experiment.py calls: opens ONE Chrome browser
    with `num_tabs` tabs, round-robins every keyword in `keywords`
    through them exactly like serp_scraper.py does, and returns
    {keyword: [{"url":..., "title":...}, ...]} for every keyword given
    (empty list for any that timed out or returned nothing).

    `on_result(keyword, top3)`, if given, is called the INSTANT each
    keyword's tab job finishes -- before the whole batch is done -- so a
    caller can fan downstream work (e.g. metadata fetch + info/comm
    classification) out to its own pool concurrently with this tab loop
    still working through the rest of the keyword list, instead of
    waiting for every keyword's top-3 before starting anything else."""
    rows = [{"keyword": kw} for kw in keywords]
    results_by_keyword = {}

    def _on_tab_result(row, results, start_time, stop_time):
        results_by_keyword[row["keyword"]] = results
        if on_result:
            on_result(row["keyword"], results)

    driver = get_driver()
    try:
        captcha_rows = run_search_pool(driver, rows, output_path=None, on_result=_on_tab_result, num_tabs=num_tabs)
        if captcha_rows:
            print(f"\n  Retrying {len(captcha_rows)} keyword(s) that hit a CAPTCHA...\n")
            run_search_pool(driver, captcha_rows, output_path=None, on_result=_on_tab_result,
                             num_tabs=num_tabs, is_retry_pass=True)
    finally:
        driver.quit()

    return results_by_keyword
