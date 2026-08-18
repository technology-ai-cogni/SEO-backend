import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time

from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# Moz API Credentials provided by user
DEFAULT_ACCESS_ID = "mozscape-Yv2u3fUIBQ"
DEFAULT_SECRET_KEY = "vuaOGTDkbQ1Zg95lzWhGlZXsoQ28dnD8"
DEFAULT_API_KEY_B64 = "bW96c2NhcGUtWXYydTNmVUlCUTp2dWFPR1REa2JRMVpnOTVseldoR2xaWHNvUTI4ZG5EOA=="

# SE Ranking API Key from project .env
SERANKING_API_KEY = os.getenv("SERANKING_API_KEY", "0bc19e9b-edc7-4032-710a-8dcbf6710190")
SERANKING_BASE_URL = "https://api.seranking.com/v1"

COUNTRY_NAMES = {
    "us": "United States [US]",
    "uk": "United Kingdom [UK]",
    "ca": "Canada [CA]",
    "au": "Australia [AU]",
    "in": "India [IN]",
    "de": "Germany [DE]",
    "fr": "France [FR]",
    "es": "Spain [ES]",
    "br": "Brazil [BR]",
    "jp": "Japan [JP]"
}


def parse_target(link_input: str) -> dict:
    """Cleanly parse input URL or domain string."""
    raw = link_input.strip()
    if not raw.startswith(("http://", "https://")):
        url_with_scheme = f"https://{raw}"
    else:
        url_with_scheme = raw

    parsed = urlparse(url_with_scheme)
    hostname = parsed.hostname or raw
    
    domain_parts = hostname.split('.')
    if len(domain_parts) > 2 and domain_parts[0] == "www":
        root_domain = ".".join(domain_parts[1:])
    else:
        root_domain = hostname

    return {
        "raw_input": raw,
        "full_url": url_with_scheme,
        "host": hostname,
        "domain": root_domain,
        "path": parsed.path or "/"
    }

def generate_moz_auth(access_id: str, secret_key: str, expires_in_seconds: int = 300):
    """
    Generate signature and expires timestamp for Mozscape API Authentication.
    """
    expires = int(time.time()) + expires_in_seconds
    string_to_sign = f"{access_id}\n{expires}"
    
    binary_signature = hmac.new(
        secret_key.encode('utf-8'),
        string_to_sign.encode('utf-8'),
        hashlib.sha1
    ).digest()
    
    url_safe_signature = quote(base64.b64encode(binary_signature).decode('utf-8'))
    return expires, url_safe_signature

def fetch_moz_metrics(target_info: dict, access_id: str, secret_key: str, b64_key: str = None) -> dict:
    """
    Fetch Moz Domain Authority (DA), Page Authority (PA), Spam Score, and Backlink count.
    Supports both standard URL metrics endpoint (lsapi.seomoz.com) and Moz V2 API endpoint.
    """
    domain = target_info["domain"]
    # Bitmask flags for Mozscape URL Metrics API:
    # 32: External Equity Links (ueid)
    # 64: Links (uid)
    # 34359738368 (1<<35): Page Authority (upa)
    # 68719476736 (1<<36): Domain Authority (pda)
    # 536870912000 (1<<39): Spam Score (fss)
    # Combined Cols bitmask: 32 + 64 + 34359738368 + 68719476736 + 536870912000 = 640026859552
    cols = 640026859552

    expires, signature = generate_moz_auth(access_id, secret_key)
    
    endpoints = [
        ("lsapi.seomoz.com", f"https://lsapi.seomoz.com/linkscape/url-metrics/{quote(domain, safe='')}?Cols={cols}&AccessID={access_id}&Expires={expires}&Signature={signature}"),
        ("lsapi.moz.com", f"https://lsapi.moz.com/linkscape/url-metrics/{quote(domain, safe='')}?Cols={cols}&AccessID={access_id}&Expires={expires}&Signature={signature}")
    ]

    last_error = None
    for name, url in endpoints:
        req = Request(url, headers={
            "User-Agent": "Moz-Checker-Script/1.0",
            "Accept": "application/json"
        })

        try:
            with urlopen(req, timeout=15) as resp:
                body = resp.read().decode('utf-8')
                data = json.loads(body)
                
                da = round(data.get("pda", 0), 1) if "pda" in data else data.get("domain_authority", 0)
                pa = round(data.get("upa", 0), 1) if "upa" in data else data.get("page_authority", 0)
                
                # Moz Spam Score fields: fsps (Subdomain Spam Score), fss (Spam Score), or fspsc (Spam Score Code)
                spam_score = data.get("fsps", data.get("fss", data.get("fspsc", 0)))
                ext_links = data.get("ueid", 0) or data.get("external_equity_links", 0)
                total_links = data.get("uid", 0) or data.get("total_links", 0)

                
                return {
                    "status": "success",
                    "endpoint": name,
                    "domain": domain,
                    "da": da,
                    "pa": pa,
                    "spam_score": f"{spam_score}%" if isinstance(spam_score, (int, float)) else str(spam_score),
                    "external_equity_links": ext_links,
                    "total_backlinks": total_links,
                    "raw_response": data
                }
        except HTTPError as e:
            err_body = e.read().decode('utf-8') if e.fp else ""
            last_error = {
                "status": "error",
                "endpoint": name,
                "error": f"HTTP {e.code}: {e.reason}",
                "status_code": e.code,
                "raw_response": err_body
            }
        except Exception as e:
            last_error = {"status": "error", "endpoint": name, "error": f"Failed to connect: {str(e)}"}

    # Attempt Moz V2 API POST if V1 endpoints fail
    if b64_key:
        try:
            v2_url = "https://moz.com/api/v2/url_metrics"
            v2_payload = json.dumps({"targets": [domain]}).encode('utf-8')
            v2_req = Request(v2_url, data=v2_payload, headers={
                "Authorization": f"Basic {b64_key}",
                "Content-Type": "application/json",
                "User-Agent": "Moz-Checker-Script/1.0"
            })
            with urlopen(v2_req, timeout=15) as resp:
                v2_data = json.loads(resp.read().decode('utf-8'))
                return {
                    "status": "success_v2",
                    "domain": domain,
                    "raw_response": v2_data
                }
        except Exception as e:
            pass

    return last_error or {"status": "error", "error": "Unknown error connecting to Moz API"}

def fetch_seranking_regional_traffic(target_info: dict, regions: list = None, api_key: str = None) -> list:
    """
    Fetch organic & paid search traffic breakdown by region using SE Ranking API.
    """
    if not api_key:
        api_key = SERANKING_API_KEY
    if not regions:
        regions = ["in", "us", "uk", "ca", "au"]

    results = []
    url = f"{SERANKING_BASE_URL}/domain/overview/db"
    
    headers = {
        "Authorization": f"Token {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

    for region in regions:
        region_code = region.strip().lower()
        full_url = f"{url}?domain={quote(target_info['domain'])}&source={region_code}&with_subdomains=1"
        req = Request(full_url, headers=headers)
        
        try:
            with urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                raw = data.get("data", data)
                
                org_obj = raw.get("organic", {})
                if isinstance(org_obj, dict):
                    org_traffic = org_obj.get("traffic_sum") or org_obj.get("traffic", 0)
                    org_kw = org_obj.get("keywords_count") or org_obj.get("keywords", 0)
                else:
                    org_traffic = raw.get("organic_traffic", 0)
                    org_kw = raw.get("organic_keywords", 0)

                paid_obj = raw.get("paid") or raw.get("adv", {})
                if isinstance(paid_obj, dict):
                    paid_traffic = paid_obj.get("traffic_sum") or paid_obj.get("traffic", 0)
                    paid_kw = paid_obj.get("keywords_count") or paid_obj.get("keywords", 0)
                else:
                    paid_traffic = raw.get("paid_traffic", 0)
                    paid_kw = raw.get("paid_keywords", 0)

                results.append({
                    "region_code": region_code.upper(),
                    "country": COUNTRY_NAMES.get(region_code, f"{region_code.upper()} Database"),
                    "organic_traffic": org_traffic,
                    "paid_traffic": paid_traffic,
                    "total_traffic": org_traffic + paid_traffic,
                    "organic_keywords": org_kw,
                    "paid_keywords": paid_kw
                })
        except HTTPError as e:
            results.append({
                "region_code": region_code.upper(),
                "country": COUNTRY_NAMES.get(region_code, f"{region_code.upper()} Database"),
                "error": f"HTTP {e.code}",
                "organic_traffic": 0,
                "paid_traffic": 0,
                "total_traffic": 0,
                "organic_keywords": 0,
                "paid_keywords": 0
            })
        except Exception as e:
            results.append({
                "region_code": region_code.upper(),
                "country": COUNTRY_NAMES.get(region_code, f"{region_code.upper()} Database"),
                "error": str(e),
                "organic_traffic": 0,
                "paid_traffic": 0,
                "total_traffic": 0,
                "organic_keywords": 0,
                "paid_keywords": 0
            })

    results.sort(key=lambda x: x.get("total_traffic", 0), reverse=True)
    return results

def format_number(val) -> str:
    if not isinstance(val, (int, float)):
        return str(val)
    if val >= 1_000_000:
        return f"{val / 1_000_000:.2f}M ({val:,})"
    elif val >= 1_000:
        return f"{val / 1_000:.1f}K ({val:,})"
    return f"{val:,}"

def check_domain_metrics(link_input: str, api_key: str = None, regions: list = None, mock: bool = False) -> dict:
    """
    Analyze a URL/domain using Moz API (DA, PA, Spam Score) + SE Ranking API (Regional Traffic).
    Returns formatted dictionary compatible with app.py.
    """
    if not regions:
        regions = ["in", "us", "uk", "ca", "au"]

    target_info = parse_target(link_input)
    moz_data = fetch_moz_metrics(target_info, DEFAULT_ACCESS_ID, DEFAULT_SECRET_KEY, DEFAULT_API_KEY_B64)
    traffic_data = fetch_seranking_regional_traffic(target_info, regions=regions)

    da = moz_data.get("da", 0) if isinstance(moz_data, dict) else 0
    pa = moz_data.get("pa", 0) if isinstance(moz_data, dict) else 0
    ss = moz_data.get("spam_score", "0%") if isinstance(moz_data, dict) else "0%"

    total_org_traffic = 0
    total_paid_traffic = 0

    valid_regions = []
    for r in traffic_data:
        if isinstance(r, dict) and not r.get("error"):
            org_t = r.get("organic_traffic", 0) or 0
            paid_t = r.get("paid_traffic", 0) or 0
            total_org_traffic += org_t
            total_paid_traffic += paid_t
            valid_regions.append(r)

    valid_regions.sort(key=lambda x: x.get("total_traffic", 0), reverse=True)
    top_3_regions = valid_regions[:3]
    
    def format_reg_str(reg_item):
        code = reg_item.get("region_code", "")
        t_val = reg_item.get("total_traffic", 0)
        formatted_t = format_number(t_val)
        return f"{code}: {formatted_t}"

    reg1_str = format_reg_str(top_3_regions[0]) if len(top_3_regions) > 0 else "-"
    reg2_str = format_reg_str(top_3_regions[1]) if len(top_3_regions) > 1 else "-"
    reg3_str = format_reg_str(top_3_regions[2]) if len(top_3_regions) > 2 else "-"

    main_traffic_val = top_3_regions[0].get("total_traffic", 0) if len(top_3_regions) > 0 else (total_org_traffic + total_paid_traffic)
    total_traffic_val = total_org_traffic + total_paid_traffic

    return {
        "url": target_info["full_url"],
        "domain": target_info["domain"],
        "da": da,
        "pa": pa,
        "ss": ss,
        "traffic": format_number(main_traffic_val),
        "totalTraffic": format_number(total_traffic_val),
        "region1Traffic": reg1_str,
        "region2Traffic": reg2_str,
        "region3Traffic": reg3_str,
        "moz_metrics": moz_data,
        "traffic_data": traffic_data
    }


def print_cli_report(target_info: dict, moz_data: dict, traffic_data: list = None):
    border = "=" * 75
    sub_border = "-" * 75

    print(f"\n{border}")
    print(f" MOZ & SE RANKING DOMAIN METRICS REPORT")
    print(f"{border}")
    print(f" Target Input  : {target_info['raw_input']}")
    print(f" Target Domain : {target_info['domain']}")
    print(f"{sub_border}")

    if moz_data.get("status") == "error":
        print(f" [!] Status      : Error ({moz_data.get('status_code', 'N/A')})")
        print(f" [!] Error Msg   : {moz_data.get('error')}")
    else:
        print(f"  * Domain Authority (DA) : {moz_data.get('da', 'N/A')} / 100")
        print(f"  * Page Authority (PA)   : {moz_data.get('pa', 'N/A')} / 100")
        print(f"  * Spam Score            : {moz_data.get('spam_score', 'N/A')}")
        print(f"  * External Equity Links : {format_number(moz_data.get('external_equity_links', 0))}")
        print(f"  * Total Backlinks       : {format_number(moz_data.get('total_backlinks', 0))}")
    
    if traffic_data:
        print(f"\n SE RANKING ESTIMATED TRAFFIC BY REGION")
        print(f" {sub_border}")
        print(f" {'Region / Country':<25} | {'Organic Traffic':<18} | {'Paid Traffic':<15} | {'Org Keywords':<12}")
        print(f" {'-'*25}-+-{'-'*18}-+-{'-'*15}-+-{'-'*12}")

        total_org = 0
        total_paid = 0

        for row in traffic_data:
            country_display = row.get("country", row.get("region_code"))
            org_t = row.get("organic_traffic", 0)
            paid_t = row.get("paid_traffic", 0)
            org_kw = row.get("organic_keywords", 0)

            total_org += org_t if isinstance(org_t, (int, float)) else 0
            total_paid += paid_t if isinstance(paid_t, (int, float)) else 0

            if "error" in row and row["error"]:
                print(f" {country_display:<25} | Error: {row['error']}")
            else:
                print(f" {country_display:<25} | {format_number(org_t):<18} | {format_number(paid_t):<15} | {format_number(org_kw):<12}")

        print(f" {'-'*25}-+-{'-'*18}-+-{'-'*15}-+-{'-'*12}")
        print(f" {'TOTAL TRAFFIC':<25} | {format_number(total_org):<18} | {format_number(total_paid):<15} |")

    print(f"{border}\n")

def main():
    parser = argparse.ArgumentParser(description="Moz & SE Ranking Domain Checker")
    parser.add_argument("domain", nargs="?", help="Target URL or domain (e.g., example.com)")
    parser.add_argument("--access-id", default=DEFAULT_ACCESS_ID, help="Moz Access ID")
    parser.add_argument("--secret-key", default=DEFAULT_SECRET_KEY, help="Moz Secret Key")
    parser.add_argument("--api-key", default=DEFAULT_API_KEY_B64, help="Moz Base64 API key")
    parser.add_argument("-r", "--regions", default="in,us,uk,ca,au", help="Comma-separated region codes (e.g. in,us,uk)")
    parser.add_argument("--json", action="store_true", help="Output raw JSON response")
    
    args = parser.parse_args()

    target_domain = args.domain
    if not target_domain:
        target_domain = input("Enter domain or URL (e.g. github.com): ").strip()
        if not target_domain:
            target_domain = "github.com"

    target_info = parse_target(target_domain)
    moz_metrics = fetch_moz_metrics(target_info, args.access_id, args.secret_key, args.api_key)
    
    regions_list = [r.strip().lower() for r in args.regions.split(",") if r.strip()]
    traffic_data = fetch_seranking_regional_traffic(target_info, regions_list)

    if args.json:
        full_result = {
            "target": target_info,
            "moz_metrics": moz_metrics,
            "regional_traffic": traffic_data
        }
        print(json.dumps(full_result, indent=2))
    else:
        print_cli_report(target_info, moz_metrics, traffic_data)

if __name__ == "__main__":
    main()

