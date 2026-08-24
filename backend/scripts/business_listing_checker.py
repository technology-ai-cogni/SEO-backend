import os
import re
import sys
import json
import ssl
import urllib.parse
import urllib.request
from typing import Dict, Any, List, Optional
from bs4 import BeautifulSoup

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


def check_business_listing(
    live_link: str,
    domain_rec: Optional[Dict[str, Any]] = None,
    rapidapi_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Audits a Business Listing activity link:
    1. Checks if live link is broken (HTTP GET status).
    2. Checks DA & SS using RapidAPI (Low DA if < 25, High SS if > 2).
    3. Checks NAP details against expected domain record in DB.

    Returns dict with keys:
      - status: "Audited-Indexed" or "Audited-LQ"
      - remarks: String of issues or "Audited-Indexed"
      - solution: Actionable suggestion
      - da: Domain Authority
      - ss: Spam Score
    """
    issues = []
    link_broken = False
    page_text = ""

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

    # 1. Fetch Live Link
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }

    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        req = urllib.request.Request(clean_url, headers=headers)
        with urllib.request.urlopen(req, context=ctx, timeout=12) as resp:
            status_code = resp.getcode()
            if status_code >= 400:
                link_broken = True
                print(f"[Business Listing Audit] [!] HTTP Status {status_code} received. Flagging Broken Link.", flush=True)
            else:
                raw_bytes = resp.read()
                page_html = raw_bytes.decode('utf-8', errors='ignore')
                soup = BeautifulSoup(page_html, 'html.parser')
                for s in soup(["script", "style", "noscript", "svg"]):
                    s.decompose()
                page_text = soup.get_text(separator=' ')
                print(f"[Business Listing Audit] [✓] Live Link Status: ACTIVE (HTTP {status_code})", flush=True)
    except Exception as e:
        link_broken = True
        print(f"[Business Listing Audit] [!] Failed to fetch live link ({e}). Flagging Broken Link.", flush=True)

    if link_broken:
        issues.append("Broken Link")

    # 2. RapidAPI DA & SS Check
    da_val = None
    ss_val = None
    target_domain = extract_root_domain(clean_url)
    api_key_to_use = rapidapi_key or RAPIDAPI_KEY

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

    # 3. NAP Details Verification
    if not link_broken and domain_rec and page_text:
        print(f"[Business Listing Audit] Verifying NAP details on page content...", flush=True)
        expected_nap = {}

        # Phone
        phone_basic = (domain_rec.get("nap_phone") or "").strip()
        phone_bc = (domain_rec.get("nap_bc_phone") or "").strip()
        phones = list(filter(None, [phone_basic, phone_bc]))
        if phones:
            expected_nap["Phone"] = phones

        # Address
        addr_basic = (domain_rec.get("nap_address") or "").strip()
        addr_bc = (domain_rec.get("nap_bc_address") or "").strip()
        addrs = list(filter(None, [addr_basic, addr_bc]))
        if addrs:
            expected_nap["Address"] = addrs

        # Email
        email_basic = (domain_rec.get("nap_email") or "").strip()
        email_bc = (domain_rec.get("nap_bc_email") or "").strip()
        emails = list(filter(None, [email_basic, email_bc]))
        if emails:
            expected_nap["Email"] = emails

        # Business Name / Business Centre
        name_bc = (domain_rec.get("nap_business_centre") or domain_rec.get("nap_business_name") or "").strip()
        proj_name = (domain_rec.get("project_name") or "").strip()
        names = list(filter(None, [name_bc, proj_name]))
        if names:
            expected_nap["Name"] = names

        # Website
        web_basic = (domain_rec.get("nap_website") or "").strip()
        web_bc = (domain_rec.get("nap_bc_website") or "").strip()
        dom_val = (domain_rec.get("domain") or "").strip()
        websites = list(filter(None, [web_basic, web_bc, dom_val]))
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
                print(f"[Business Listing Audit] [✓] All expected NAP categories verified on page!", flush=True)

    # Final Remarks & Status Determination
    if not issues:
        print(f"[Business Listing Audit] RESULT -> Status: 'Audited-Indexed' | Remarks: 'Audited-Indexed'", flush=True)
        print(f"[Business Listing Audit] ----------------------------------------\n", flush=True)
        return {
            "status": "Audited-Indexed",
            "remarks": "Audited-Indexed",
            "solution": "fixed",
            "da": da_val,
            "ss": ss_val
        }
    else:
        remarks_str = ", ".join(issues)
        solution = "Update Business Listing / Fix NAP"
        if "Broken Link" in issues:
            solution = "Replace Business Listing Link"
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
