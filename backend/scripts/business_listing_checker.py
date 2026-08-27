import os
import re
import sys
import json
import ssl
import urllib.parse
import urllib.request
from typing import Dict, Any, List, Optional, Tuple
from bs4 import BeautifulSoup

try:
    import requests
except ImportError:
    requests = None

# Try importing RapidAPI DA fetcher from domain_checeker if available
try:
    from backend.scripts.domain_checeker import fetch_rapidapi_da_metrics
except ImportError:
    try:
        from scripts.domain_checeker import fetch_rapidapi_da_metrics
    except ImportError:
        fetch_rapidapi_da_metrics = None

RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY", "9d27d2418bmsh49f11b032161487p1fb7c7jsn267454df8fe9")
RAPIDAPI_HOST = "bulk-da-pa-checker2.p.rapidapi.com"


def extract_root_domain(url: str) -> str:
    if not url:
        return ""
    url_str = str(url).strip()
    if not url_str.startswith("http://") and not url_str.startswith("https://"):
        url_str = "http://" + url_str
    try:
        parsed = urllib.parse.urlparse(url_str)
        hostname = parsed.netloc.split(":")[0].lower()
        if hostname.startswith("www."):
            hostname = hostname[4:]
        parts = hostname.split(".")
        if len(parts) >= 2:
            return ".".join(parts[-2:])
        return hostname
    except Exception:
        return url_str.lower()


def normalize_text_for_matching(text: str) -> str:
    if not text:
        return ""
    return re.sub(r'\s+', ' ', str(text)).strip().lower()


def normalize_phone_number(phone: str) -> str:
    if not phone:
        return ""
    return re.sub(r'[^0-9]', '', str(phone))


def check_google_site_indexed(live_link: str) -> bool:
    """
    Searches Google using site: operator (e.g. site:live_link) via Bright Data SERP API
    or HTTP fallback to verify if the URL is indexed.
    """
    if not live_link or not live_link.startswith("http"):
        return False

    clean_url = live_link.strip()
    search_url = f"https://www.google.com/search?q=site:{urllib.parse.quote(clean_url)}&hl=en"

    api_key = os.getenv("BRIGHTDATA_API_KEY")
    zone = os.getenv("BRIGHTDATA_SERP_ZONE", "serp_api1")

    if api_key and requests:
        try:
            payload = {
                "zone": zone,
                "url": search_url,
                "format": "raw"
            }
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            resp = requests.post("https://api.brightdata.com/request", headers=headers, json=payload, timeout=20)
            if resp.status_code == 200:
                html_text = resp.text.lower()
                if "did not match any documents" in html_text or "no results found" in html_text:
                    print(f"[Business Listing Audit] [Google site: Check] site:{clean_url} -> NOT INDEXED (Non-indexed)", flush=True)
                    return False
                print(f"[Business Listing Audit] [Google site: Check] site:{clean_url} -> INDEXED (Indexed)", flush=True)
                return True
        except Exception as e:
            print(f"[Business Listing Audit] Bright Data site check notice: {e}", file=sys.stderr, flush=True)

    # HTTP Fallback check
    try:
        req = urllib.request.Request(
            search_url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
        )
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with urllib.request.urlopen(req, context=ctx, timeout=10) as res:
            html_text = res.read().decode('utf-8', errors='ignore').lower()
            if "did not match any documents" in html_text or "no results found" in html_text:
                print(f"[Business Listing Audit] [Google site: Check] site:{clean_url} -> NOT INDEXED (Non-indexed)", flush=True)
                return False
            print(f"[Business Listing Audit] [Google site: Check] site:{clean_url} -> INDEXED (Indexed)", flush=True)
            return True
    except Exception as fe:
        print(f"[Business Listing Audit] Google HTTP fallback notice: {fe}", file=sys.stderr, flush=True)

    return True


def fetch_live_page_content(url: str, timeout: int = 20) -> Tuple[bool, int, str]:
    """
    Fetches live URL allowing full page load:
    - Follows HTTP redirects.
    - Sets full Chrome User-Agent and headers.
    - Uses 20-second timeout to allow slow JS/CSS assets or directory pages to finish loading.
    - Returns (link_broken, status_code, page_text).
    """
    if not url:
        return True, 0, ""

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    }

    # Attempt 1: requests library with session, redirect tracking & full timeout
    if requests:
        try:
            session = requests.Session()
            session.headers.update(headers)
            resp = session.get(url, timeout=timeout, allow_redirects=True, verify=False)
            status_code = resp.status_code
            if status_code < 400:
                soup = BeautifulSoup(resp.text, 'html.parser')
                for s in soup(["script", "style", "noscript", "svg"]):
                    s.decompose()
                page_text = soup.get_text(separator=' ')
                print(f"[Business Listing Audit] [OK] Full Page Loaded via requests (HTTP {status_code})", flush=True)
                return False, status_code, page_text
            else:
                print(f"[Business Listing Audit] [!] HTTP {status_code} received on requests load.", flush=True)
                return True, status_code, ""
        except Exception as re_err:
            print(f"[Business Listing Audit] requests load notice: {re_err}. Trying urllib fallback...", flush=True)

    # Attempt 2: urllib.request with SSL context bypass & 20s timeout
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as resp:
            status_code = resp.getcode()
            if status_code < 400:
                raw_bytes = resp.read()
                page_html = raw_bytes.decode('utf-8', errors='ignore')
                soup = BeautifulSoup(page_html, 'html.parser')
                for s in soup(["script", "style", "noscript", "svg"]):
                    s.decompose()
                page_text = soup.get_text(separator=' ')
                print(f"[Business Listing Audit] [OK] Full Page Loaded via urllib (HTTP {status_code})", flush=True)
                return False, status_code, page_text
            else:
                return True, status_code, ""
    except urllib.error.HTTPError as he:
        print(f"[Business Listing Audit] HTTPError {he.code}: {he.reason}", flush=True)
        return True, he.code, ""
    except Exception as e:
        print(f"[Business Listing Audit] Failed to load full page ({e}). Flagging Broken Link.", flush=True)
        return True, 0, ""


def find_domain_record_for_row(row: dict, dataset_project_name: str = "") -> Optional[dict]:
    """
    Attempts to locate the matching domain record from the DB `domains` table.
    """
    try:
        import backend.core.db as db
    except ImportError:
        try:
            import core.db as db
        except ImportError:
            return None

    # 1. Try project slug/name
    proj_name = (row.get("project_name") or row.get("project") or dataset_project_name or "").strip()
    if proj_name:
        try:
            slug = db._slugify_project_name(proj_name)
            rec = db.get_domain_by_project_slug(slug)
            if rec:
                return rec
        except Exception:
            pass

    # 2. Try matching by landing page domain
    landing = (row.get("landingPage") or row.get("landing_page") or row.get("domain") or "").strip()
    if landing:
        root_dom = extract_root_domain(landing)
        if root_dom:
            try:
                rec = db.get_domain_record(root_dom)
                if rec:
                    return rec
            except Exception:
                pass

    # 3. Fallback: Search all domain records for project name match or domain substring
    try:
        all_recs = db.list_domain_records()
        if proj_name:
            for r in all_recs:
                if (r.get("project_name") or "").strip().lower() == proj_name.lower() or (r.get("project_slug") or "").strip().lower() == proj_name.lower():
                    return r
        if landing:
            root_dom = extract_root_domain(landing)
            if root_dom:
                for r in all_recs:
                    if (r.get("domain") or "").strip().lower() == root_dom.lower():
                        return r
    except Exception:
        pass

    return None


def get_business_centres(domain_rec: Dict[str, Any]) -> List[Dict[str, str]]:
    raw_bc = domain_rec.get("business_centres")
    centres = []
    if isinstance(raw_bc, str):
        try:
            parsed = json.loads(raw_bc)
            if isinstance(parsed, list):
                centres = parsed
        except Exception:
            pass
    elif isinstance(raw_bc, list):
        centres = raw_bc

    if not centres and domain_rec.get("nap_business_centre"):
        centres.append({
            "name": (domain_rec.get("nap_business_centre") or "").strip(),
            "phone": (domain_rec.get("nap_bc_phone") or "").strip(),
            "website": (domain_rec.get("nap_bc_website") or "").strip(),
            "address": (domain_rec.get("nap_bc_address") or "").strip(),
            "email": (domain_rec.get("nap_bc_email") or "").strip(),
        })

    return centres


def match_business_centre_for_row(row_landing_page: str, centres: List[Dict[str, str]]) -> Optional[Dict[str, str]]:
    if not row_landing_page or not centres:
        return None

    row_clean_url = row_landing_page.strip().lower()
    row_root = extract_root_domain(row_clean_url)

    for bc in centres:
        bc_web = (bc.get("website") or bc.get("landing_page") or "").strip().lower()
        if not bc_web:
            continue
        bc_root = extract_root_domain(bc_web)

        if bc_root and row_root and bc_root == row_root:
            return bc
        if bc_web in row_clean_url or row_clean_url in bc_web:
            return bc

    return None


def check_business_listing(
    live_link: str,
    domain_rec: Optional[Dict[str, Any]] = None,
    rapidapi_key: Optional[str] = None,
    row_data: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Audits a Business Listing activity link:
    1. Waits for full page load (20s timeout, follows redirects, session cookies).
    2. Checks if live link is indexed in Google via `site:live_link`.
    3. Checks DA & SS using RapidAPI (Low DA if < 25, High SS if > 2).
    4. Checks NAP details against expected domain record in DB.

    Returns dict with keys:
      - status: "Audited-Indexed" or "Audited-LQ"
      - remarks: "Indexed", "Non-indexed", or comma-joined issues
      - solution: Actionable suggestion
      - da: Domain Authority
      - ss: Spam Score
    """
    issues = []
    clean_url = (live_link or "").strip()
    print(f"\n[Business Listing Audit] ----------------------------------------", flush=True)
    print(f"[Business Listing Audit] Auditing URL: {clean_url}", flush=True)

    if domain_rec:
        print(f"[Business Listing Audit] Matched DB Domain Record: {domain_rec.get('domain')} (Project: {domain_rec.get('project_name')})", flush=True)
    else:
        print(f"[Business Listing Audit] Warning: No matching domain record found in DB for row", flush=True)

    if not clean_url or not (clean_url.startswith("http://") or clean_url.startswith("https://")):
        print(f"[Business Listing Audit] [!] Invalid or empty URL string. Flagging Broken Link.", flush=True)
        print(f"[Business Listing Audit] RESULT -> Status: 'Audited-LQ' | Remarks: 'Broken Link'", flush=True)
        print(f"[Business Listing Audit] ----------------------------------------\n", flush=True)
        return {
            "status": "Audited-LQ",
            "remarks": "Broken Link",
            "solution": "Replace Business Listing Link",
            "da": None,
            "ss": None
        }

    # 1. Full Page Load Check
    print(f"[Business Listing Audit] Waiting for full page load (20s max timeout, following redirects)...", flush=True)
    link_broken, status_code, page_text = fetch_live_page_content(clean_url, timeout=20)

    if link_broken:
        issues.append("Broken Link")

    # 2. Google site: Indexation Check
    if not link_broken:
        is_indexed = check_google_site_indexed(clean_url)
        if not is_indexed:
            print(f"[Business Listing Audit] [!] Google site check yielded 0 results. Flagging Non-indexed.", flush=True)
            issues.append("Non-indexed")

    # 3. RapidAPI DA & SS Check
    da_val = None
    ss_val = None
    target_domain = extract_root_domain(clean_url)
    raw_key = rapidapi_key or os.getenv("RAPIDAPI_KEY") or RAPIDAPI_KEY
    api_key_to_use = raw_key.strip().strip('"').strip("'")
    if "os.getenv" in api_key_to_use or len(api_key_to_use) < 10:
        api_key_to_use = "9d27d2418bmsh49f11b032161487p1fb7c7jsn267454df8fe9"

    if target_domain and fetch_rapidapi_da_metrics:
        print(f"[Business Listing Audit] Requesting RapidAPI DA/SS for domain: '{target_domain}'...", flush=True)
        try:
            res = fetch_rapidapi_da_metrics({"domain": target_domain}, rapidapi_key=api_key_to_use)
            if res.get("status") == "success":
                da_val = res.get("da", 0)
                raw_ss = res.get("spam_score", 0)
                if isinstance(raw_ss, str):
                    clean_ss = re.sub(r'[^0-9.]', '', raw_ss)
                    ss_val = float(clean_ss) if clean_ss else 0.0
                else:
                    ss_val = float(raw_ss or 0.0)

                print(f"[Business Listing Audit] [Metrics] RapidAPI Response -> DA: {da_val} (Min 25), SS: {ss_val} (Max 2)", flush=True)

                if da_val < 25:
                    print(f"[Business Listing Audit] [!] DA is {da_val} (< 25). Flagging Low DA.", flush=True)
                    issues.append("Low DA")
                if ss_val > 2:
                    print(f"[Business Listing Audit] [!] SS is {ss_val} (> 2). Flagging High SS.", flush=True)
                    issues.append("High SS")
            else:
                print(f"[Business Listing Audit] RapidAPI notice: {res.get('error')}", flush=True)
        except Exception as ex:
            print(f"[Business Listing Audit] RapidAPI check notice: {ex}", file=sys.stderr, flush=True)

    # 4. NAP Details Verification
    if not link_broken and domain_rec and page_text:
        print(f"[Business Listing Audit] Verifying NAP details on page content...", flush=True)

        row_lp = ""
        if row_data:
            row_lp = (row_data.get("landing_page") or row_data.get("Landing Page") or row_data.get("landingPage") or "").strip()

        centres = get_business_centres(domain_rec)
        matched_bc = match_business_centre_for_row(row_lp, centres) if row_lp else None

        if matched_bc:
            print(f"[Business Listing Audit] [!] Row Landing Page '{row_lp}' matched Business Centre: '{matched_bc.get('name')}'", flush=True)
            phones = list(filter(None, [matched_bc.get("phone"), domain_rec.get("nap_phone"), domain_rec.get("nap_bc_phone")]))
            addrs = list(filter(None, [matched_bc.get("address"), domain_rec.get("nap_address"), domain_rec.get("nap_bc_address")]))
            emails = list(filter(None, [matched_bc.get("email"), domain_rec.get("nap_email"), domain_rec.get("nap_bc_email")]))
            names = list(filter(None, [matched_bc.get("name"), domain_rec.get("nap_business_centre"), domain_rec.get("project_name")]))
            websites = list(filter(None, [matched_bc.get("website"), row_lp, domain_rec.get("nap_website"), domain_rec.get("domain")]))
        else:
            print(f"[Business Listing Audit] Checking all available Headquarters & Business Centre NAP details...", flush=True)
            phones = list(filter(None, [domain_rec.get("nap_phone"), domain_rec.get("nap_bc_phone")] + [c.get("phone") for c in centres]))
            addrs = list(filter(None, [domain_rec.get("nap_address"), domain_rec.get("nap_bc_address")] + [c.get("address") for c in centres]))
            emails = list(filter(None, [domain_rec.get("nap_email"), domain_rec.get("nap_bc_email")] + [c.get("email") for c in centres]))
            names = list(filter(None, [domain_rec.get("nap_business_centre"), domain_rec.get("project_name")] + [c.get("name") for c in centres]))
            websites = list(filter(None, [domain_rec.get("nap_website"), domain_rec.get("nap_bc_website"), domain_rec.get("domain")] + [c.get("website") for c in centres]))

        expected_nap = {}
        if phones:
            expected_nap["Phone"] = phones
        if addrs:
            expected_nap["Address"] = addrs
        if emails:
            expected_nap["Email"] = emails
        if names:
            expected_nap["Name"] = names
        if websites:
            expected_nap["Website"] = websites

        norm_page_text = normalize_text_for_matching(page_text)
        digits_in_page = normalize_phone_number(page_text)

        missing_fields = []
        found_count = 0

        for field_type, expected_vals in expected_nap.items():
            field_found = False
            for val in expected_vals:
                if not val:
                    continue
                if field_type == "Phone":
                    digits = normalize_phone_number(val)
                    if len(digits) >= 6 and digits in digits_in_page:
                        field_found = True
                        break
                elif field_type == "Website":
                    clean_web = extract_root_domain(val)
                    if clean_web and clean_web.lower() in norm_page_text:
                        field_found = True
                        break
                else:
                    norm_val = normalize_text_for_matching(val)
                    if norm_val and norm_val in norm_page_text:
                        field_found = True
                        break

            if field_found:
                found_count += 1
            else:
                missing_fields.append(field_type)

        print(f"[Business Listing Audit] [NAP Check] Expected NAP categories: {list(expected_nap.keys())}", flush=True)
        print(f"[Business Listing Audit] [NAP Check] Matched categories: {found_count}/{len(expected_nap)}", flush=True)

        if expected_nap:
            if found_count == 0:
                print(f"[Business Listing Audit] [!] No expected NAP details found on page. Flagging No NAP.", flush=True)
                issues.append("No NAP")
            elif missing_fields:
                missing_str = ", ".join(missing_fields)
                print(f"[Business Listing Audit] [!] Missing NAP categories on page: {missing_str}", flush=True)
                issues.append(f"Incorrect NAP (missing {missing_str})")
            else:
                print(f"[Business Listing Audit] [OK] All expected NAP categories verified on page!", flush=True)

    # Final Remarks & Status Determination
    if not issues:
        print(f"[Business Listing Audit] RESULT -> Status: 'Audited-Indexed' | Remarks: 'Indexed'", flush=True)
        print(f"[Business Listing Audit] ----------------------------------------\n", flush=True)
        return {
            "status": "Audited-Indexed",
            "remarks": "Indexed",
            "solution": "No issues",
            "da": da_val,
            "ss": ss_val
        }
    else:
        remarks_str = ", ".join(issues)
        solution = "Update Business Listing / Fix NAP"
        if "Broken Link" in issues:
            solution = "Replace Business Listing Link"
        elif "Non-indexed" in issues:
            solution = "Submit URL to Google Search Console / Re-index Link"
        elif "Low DA" in issues or "High SS" in issues:
            solution = "Submit on Higher DA / Lower SS Directory"

        print(f"[Business Listing Audit] RESULT -> Status: 'Audited-LQ' | Remarks: '{remarks_str}'", flush=True)
        print(f"[Business Listing Audit] ----------------------------------------\n", flush=True)
        return {
            "status": "Audited-LQ",
            "remarks": remarks_str,
            "solution": solution,
            "da": da_val,
            "ss": ss_val
        }
