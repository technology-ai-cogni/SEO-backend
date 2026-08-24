"""
Paid Guest Post Checker Tool
Uses Bright Data and Playwright to audit guest post live links.

Checks performed:
1. Link Broken Check: Verifies if live URL is accessible or broken (HTTP 4xx/5xx / connection error).
2. Keyword 1 & Keyword 2 Presence: Verifies if target keywords exist on the page.
3. Keyword Hyperlink Anchor: Checks if keywords are anchored with a hyperlink (<a> tag).
4. Target URL / Redirection Matching: Verifies if keyword hyperlinks redirect/point to the correct target URL.
"""

import os
import re
import sys
import json
import argparse
import asyncio
from typing import Dict, Any, Optional, List, Tuple
from urllib.parse import urlparse, urljoin
from dotenv import load_dotenv

# Load environment variables from current dir or backend/.env
load_dotenv()
backend_env = os.path.join(os.path.dirname(__file__), "..", ".env")
if os.path.exists(backend_env):
    load_dotenv(backend_env)

try:
    from playwright.async_api import async_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False


def _normalize_domain(url: str) -> str:
    """Extract clean domain/hostname for comparison (e.g., 'example.com')."""
    if not url:
        return ""
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url
    parsed = urlparse(url)
    netloc = parsed.netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    return netloc.strip()


def _normalize_full_url(url: str) -> str:
    """Normalize full URL by stripping trailing slashes and queries if needed."""
    if not url:
        return ""
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url
    parsed = urlparse(url)
    path = parsed.path.rstrip("/")
    return f"{parsed.scheme}://{parsed.netloc.lower()}{path}"


async def check_paid_guest_post(
    live_url: str,
    keyword1: str = "",
    keyword2: str = "",
    target_url: str = "",
    use_bright_data: bool = True,
    headless: bool = False,
    timeout_ms: int = 30000
) -> Dict[str, Any]:
    """
    Audits a paid guest post URL using Bright Data / Playwright.
    """
    result = {
        "live_url": live_url,
        "is_broken": False,
        "status_code": 0,
        "error_message": None,
        "keyword1": keyword1,
        "keyword1_present": False,
        "keyword1_has_hyperlink": False,
        "keyword1_href": None,
        "keyword2": keyword2,
        "keyword2_present": False,
        "keyword2_has_hyperlink": False,
        "keyword2_href": None,
        "target_url": target_url,
        "target_url_matched": False,
        "final_destination_url": None,
        "found_links": [],
        "status": "Audited-LQ",
        "remarks": "Pending",
        "solution": "Pending"
    }

    if not live_url:
        result["is_broken"] = True
        result["remarks"] = "broken link"
        result["solution"] = "Provide Live Link"
        return result

    # Format live URL
    if not live_url.startswith("http://") and not live_url.startswith("https://"):
        live_url = "https://" + live_url
        result["live_url"] = live_url

    if not PLAYWRIGHT_AVAILABLE:
        print("[Warning] Playwright not installed. Falling back to HTTP requests...")
        return _check_with_requests(live_url, keyword1, keyword2, target_url)

    playwright = None
    browser = None
    context = None
    page = None

    try:
        playwright = await async_playwright().start()
        wss_url = os.getenv("BRIGHTDATA_WSS_URL")

        if use_bright_data and wss_url:
            print(f"[Guest Post Checker] Connecting to Bright Data Scraping Browser via CDP...")
            browser = await playwright.chromium.connect_over_cdp(wss_url)
        else:
            print(f"[Guest Post Checker] Launching local Chromium browser (headless={headless})...")
            browser = await playwright.chromium.launch(
                headless=headless,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-blink-features=AutomationControlled"
                ]
            )

        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            viewport={"width": 1366, "height": 768},
            locale="en-US"
        )
        page = await context.new_page()

        # Step 1: Open URL & Check if Link is Broken
        print(f"[Guest Post Checker] Navigating to: {live_url}")
        response = None
        try:
            response = await page.goto(live_url, wait_until="domcontentloaded", timeout=timeout_ms)
        except Exception as nav_err:
            print(f"[Guest Post Checker] Playwright navigation notice: {nav_err}. Falling back to HTTP check...")
            return _check_with_requests(live_url, keyword1, keyword2, target_url)

        if response:
            result["status_code"] = response.status
            if response.status >= 400:
                result["is_broken"] = True

        if result["is_broken"]:
            result["status"] = "Audited-LQ"
            result["remarks"] = "broken link"
            result["solution"] = "Replace Guest Post Link"
            return result

        # Wait briefly for dynamic elements
        await page.wait_for_timeout(2000)

        # Step 2: Extract Page Content & Check Keyword Presence
        page_text = ""
        try:
            page_text = await page.inner_text("body")
        except Exception:
            page_text = await page.content()

        page_text_clean = " ".join(page_text.split()).lower()

        kw1_clean = keyword1.strip().lower() if keyword1 else ""
        kw2_clean = keyword2.strip().lower() if keyword2 else ""

        if kw1_clean:
            result["keyword1_present"] = kw1_clean in page_text_clean
        if kw2_clean:
            result["keyword2_present"] = kw2_clean in page_text_clean

        # Step 3: Extract Links & Check Keyword Anchors
        anchor_elements = await page.query_selector_all("a[href]")
        extracted_links = []

        for anchor in anchor_elements:
            try:
                href = await anchor.get_attribute("href")
                text = await anchor.inner_text()
                if not href or href.startswith("javascript:") or href.startswith("#"):
                    continue

                abs_href = urljoin(live_url, href)
                anchor_text_clean = " ".join((text or "").split()).lower()

                extracted_links.append({"text": text.strip(), "href": abs_href})

                # Match Keyword 1 anchor
                if kw1_clean and kw1_clean in anchor_text_clean:
                    result["keyword1_has_hyperlink"] = True
                    result["keyword1_href"] = abs_href

                # Match Keyword 2 anchor
                if kw2_clean and kw2_clean in anchor_text_clean:
                    result["keyword2_has_hyperlink"] = True
                    result["keyword2_href"] = abs_href

            except Exception:
                continue

        result["found_links"] = extracted_links[:20]  # Store first 20 links for reference

        # Step 4: Verify Redirection & Target URL Match
        target_clean_domain = _normalize_domain(target_url) if target_url else ""
        matched = False
        final_dest = None

        # Check matched hrefs for target URL/domain
        candidate_hrefs = []
        if result["keyword1_href"]:
            candidate_hrefs.append(result["keyword1_href"])
        if result["keyword2_href"]:
            candidate_hrefs.append(result["keyword2_href"])

        # Fallback: check all links if keywords didn't map to specific anchors
        if not candidate_hrefs and target_clean_domain:
            for link in extracted_links:
                if target_clean_domain in _normalize_domain(link["href"]):
                    candidate_hrefs.append(link["href"])

        for href in candidate_hrefs:
            link_domain = _normalize_domain(href)
            if target_clean_domain and target_clean_domain in link_domain:
                matched = True
                final_dest = href
                break
            else:
                # Test redirection by loading link in page context or head request
                try:
                    redir_resp = await page.goto(href, wait_until="domcontentloaded", timeout=15000)
                    final_url = page.url
                    if target_clean_domain and target_clean_domain in _normalize_domain(final_url):
                        matched = True
                        final_dest = final_url
                        break
                except Exception:
                    pass

        result["target_url_matched"] = matched
        result["final_destination_url"] = final_dest or (candidate_hrefs[0] if candidate_hrefs else None)

        # Step 5: Assign exact requested remarks & status according to audit rules
        # 1. Broken Link Check
        if result["is_broken"]:
            result["status"] = "Audited-LQ"
            result["remarks"] = "broken link"
            result["solution"] = "Replace Guest Post Link"
            return result

        issues = []

        # 2. No Anchor Text at all on page
        if len(extracted_links) == 0:
            issues.append("no anchor text")

        # 3. Incorrect Anchor Text (neither kw1 nor kw2 present on page)
        if kw1_clean and kw2_clean and not result["keyword1_present"] and not result["keyword2_present"]:
            issues.append("incorrect anchor text")
        elif kw1_clean and not kw2_clean and not result["keyword1_present"]:
            issues.append("incorrect anchor text")
        elif kw2_clean and not kw1_clean and not result["keyword2_present"]:
            issues.append("incorrect anchor text")

        # 4. Anchor Text Missed KW1
        if kw1_clean and result["keyword1_present"] and not result["keyword1_has_hyperlink"]:
            issues.append("anchor text missed-kw1")

        # 5. Anchor Text Missed KW2
        if kw2_clean and result["keyword2_present"] and not result["keyword2_has_hyperlink"]:
            issues.append("anchor text missed kw-2")

        # Check target URL matches for kw1 and kw2 hrefs
        kw1_url_matched = False
        if kw1_clean and result["keyword1_href"] and target_clean_domain:
            if target_clean_domain in _normalize_domain(result["keyword1_href"]):
                kw1_url_matched = True
            else:
                try:
                    redir_resp = await page.goto(result["keyword1_href"], wait_until="domcontentloaded", timeout=15000)
                    if target_clean_domain in _normalize_domain(page.url):
                        kw1_url_matched = True
                except Exception:
                    pass

        kw2_url_matched = False
        if kw2_clean and result["keyword2_href"] and target_clean_domain:
            if target_clean_domain in _normalize_domain(result["keyword2_href"]):
                kw2_url_matched = True
            else:
                try:
                    redir_resp = await page.goto(result["keyword2_href"], wait_until="domcontentloaded", timeout=15000)
                    if target_clean_domain in _normalize_domain(page.url):
                        kw2_url_matched = True
                except Exception:
                    pass

        # 6. Wrong URL Targeted KW1
        if kw1_clean and result["keyword1_has_hyperlink"] and target_url and not kw1_url_matched:
            issues.append("wrong url targeted - kw1")

        # 7. Wrong URL Targeted KW2
        if kw2_clean and result["keyword2_has_hyperlink"] and target_url and not kw2_url_matched:
            issues.append("wrong url targeted- kw2")

        if issues:
            result["status"] = "Audited-LQ"
            result["remarks"] = ", ".join(issues)
            if "no anchor text" in issues or "anchor text missed-kw1" in issues or "anchor text missed kw-2" in issues:
                result["solution"] = "Add Hyperlink"
            elif "wrong url targeted - kw1" in issues or "wrong url targeted- kw2" in issues:
                result["solution"] = "Fix Destination Link"
            else:
                result["solution"] = "Content Replace"
        else:
            result["status"] = "Audited-Indexed"
            result["remarks"] = "Indexed"
            result["solution"] = "fixed"

    except Exception as e:
        print(f"[Guest Post Checker] Playwright error: {e}. Falling back to HTTP check...")
        return _check_with_requests(live_url, keyword1, keyword2, target_url)

    finally:
        if page:
            try:
                await page.close()
            except Exception:
                pass
        if context:
            try:
                await context.close()
            except Exception:
                pass
        if browser:
            try:
                await browser.close()
            except Exception:
                pass
        if playwright:
            try:
                await playwright.stop()
            except Exception:
                pass

    return result


def _check_with_requests(
    live_url: str,
    keyword1: str = "",
    keyword2: str = "",
    target_url: str = ""
) -> Dict[str, Any]:
    """Fallback HTTP checker using requests / urllib & BeautifulSoup if Playwright is unavailable or fails."""
    import ssl
    import urllib.request
    from bs4 import BeautifulSoup

    result = {
        "live_url": live_url,
        "is_broken": False,
        "status_code": 0,
        "error_message": None,
        "keyword1": keyword1,
        "keyword1_present": False,
        "keyword1_has_hyperlink": False,
        "keyword1_href": None,
        "keyword2": keyword2,
        "keyword2_present": False,
        "keyword2_has_hyperlink": False,
        "keyword2_href": None,
        "target_url": target_url,
        "target_url_matched": False,
        "final_destination_url": None,
        "status": "Audited-LQ",
        "remarks": "Pending",
        "solution": "Pending"
    }

    if not live_url:
        result["is_broken"] = True
        result["remarks"] = "broken link"
        result["solution"] = "Provide Live Link"
        return result

    clean_url = live_url if (live_url.startswith("http://") or live_url.startswith("https://")) else "https://" + live_url

    html_content = ""
    status_code = 0

    if REQUESTS_AVAILABLE:
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            }
            resp = requests.get(clean_url, headers=headers, timeout=15, allow_redirects=True, verify=False)
            status_code = resp.status_code
            if status_code < 400:
                html_content = resp.text
        except Exception:
            pass

    if not html_content:
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            }
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE

            req = urllib.request.Request(clean_url, headers=headers)
            with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
                status_code = resp.getcode()
                if status_code < 400:
                    html_content = resp.read().decode('utf-8', errors='ignore')
        except Exception as e:
            print(f"[Guest Post HTTP Check] Request failed for {clean_url}: {e}", flush=True)
            result["is_broken"] = True
            result["error_message"] = str(e)
            result["remarks"] = "broken link"
            result["solution"] = "Replace Guest Post Link"
            return result

    if status_code >= 400 or not html_content:
        result["is_broken"] = True
        result["status_code"] = status_code
        result["remarks"] = "broken link"
        result["solution"] = "Replace Guest Post Link"
        return result

    # HTTP GET succeeded (HTTP 200 OK)!
    result["status_code"] = status_code
    result["is_broken"] = False

    soup = BeautifulSoup(html_content, 'html.parser')
    page_text = soup.get_text(separator=' ').lower()

    kw1_clean = keyword1.strip().lower() if keyword1 else ""
    kw2_clean = keyword2.strip().lower() if keyword2 else ""
    target_clean_domain = _normalize_domain(target_url) if target_url else ""

    if kw1_clean:
        result["keyword1_present"] = kw1_clean in page_text
    if kw2_clean:
        result["keyword2_present"] = kw2_clean in page_text

    for a in soup.find_all('a', href=True):
        href = a.get('href', '').strip()
        text = a.get_text().strip().lower()
        if not href or href.startswith("javascript:") or href.startswith("#"):
            continue

        if kw1_clean and kw1_clean in text:
            result["keyword1_has_hyperlink"] = True
            result["keyword1_href"] = href
        if kw2_clean and kw2_clean in text:
            result["keyword2_has_hyperlink"] = True
            result["keyword2_href"] = href

        if target_clean_domain and target_clean_domain in href.lower():
            result["target_url_matched"] = True

    issues = []
    if kw1_clean and kw2_clean and not result["keyword1_present"] and not result["keyword2_present"]:
        issues.append("incorrect anchor text")
    elif kw1_clean and not kw2_clean and not result["keyword1_present"]:
        issues.append("incorrect anchor text")
    elif kw2_clean and not kw1_clean and not result["keyword2_present"]:
        issues.append("incorrect anchor text")

    if kw1_clean and result["keyword1_present"] and not result["keyword1_has_hyperlink"]:
        issues.append("anchor text missed-kw1")
    if kw2_clean and result["keyword2_present"] and not result["keyword2_has_hyperlink"]:
        issues.append("anchor text missed kw-2")

    if target_clean_domain and not result["target_url_matched"]:
        issues.append("wrong url targeted")

    if issues:
        result["status"] = "Audited-LQ"
        result["remarks"] = ", ".join(issues)
        if "anchor text missed-kw1" in issues or "anchor text missed kw-2" in issues:
            result["solution"] = "Add Hyperlink"
        elif "wrong url targeted" in issues:
            result["solution"] = "Fix Destination Link"
        else:
            result["solution"] = "Content Replace"
    else:
        result["status"] = "Audited-Indexed"
        result["remarks"] = "Indexed"
        result["solution"] = "fixed"

    return result


def main():
    parser = argparse.ArgumentParser(description="Paid Guest Post Auditor Tool")
    parser.add_argument("--url", required=True, help="Live guest post URL to audit")
    parser.add_argument("--keyword1", default="", help="Keyword 1 to check")
    parser.add_argument("--keyword2", default="", help="Keyword 2 to check")
    parser.add_argument("--target_url", default="", help="Expected target URL or domain")
    parser.add_argument("--no-brightdata", action="store_true", help="Disable Bright Data CDP connection")
    parser.add_argument("--headful", action="store_true", help="Run browser in headful mode")

    args = parser.parse_args()

    print("\n--- Running Paid Guest Post Audit ---")
    print(f"URL: {args.url}")
    print(f"Keyword 1: {args.keyword1}")
    print(f"Keyword 2: {args.keyword2}")
    print(f"Target URL: {args.target_url}\n")

    res = asyncio.run(check_paid_guest_post(
        live_url=args.url,
        keyword1=args.keyword1,
        keyword2=args.keyword2,
        target_url=args.target_url,
        use_bright_data=not args.no_brightdata,
        headless=not args.headful
    ))

    print("\n--- Audit Results ---")
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
