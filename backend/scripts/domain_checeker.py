import argparse
import http.client
import json
import os
import sys
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# RapidAPI Key & Host
RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY", "9d27d2418bmsh49f11b032161487p1fb7c7jsn267454df8fe9")
RAPIDAPI_HOST = "bulk-da-pa-checker2.p.rapidapi.com"

# SE Ranking API Key from project .env (used ONLY for regional breakdown)
SERANKING_API_KEY = os.getenv("SERANKING_API_KEY", "3847ddf8-428d-4849-b0df-8fe5faa3bacb")
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


def fetch_rapidapi_da_metrics(target_info: dict, rapidapi_key: str = None) -> dict:
    """
    Fetch Domain Authority (DA), Page Authority (PA), Spam Score (SS),
    Domain Rating (DR), and Total Organic Traffic using RapidAPI bulk-da-pa-checker2 endpoint.
    """
    domain = target_info["domain"]
    raw_key = rapidapi_key or os.getenv("RAPIDAPI_KEY") or RAPIDAPI_KEY
    api_key = raw_key.strip().strip('"').strip("'")
    if "os.getenv" in api_key or len(api_key) < 10:
        api_key = "9d27d2418bmsh49f11b032161487p1fb7c7jsn267454df8fe9"

    conn = http.client.HTTPSConnection(RAPIDAPI_HOST)
    payload = f"domains={domain}"

    headers = {
        'x-rapidapi-key': api_key,
        'x-rapidapi-host': RAPIDAPI_HOST,
        'Content-Type': "application/x-www-form-urlencoded"
    }

    try:
        conn.request("POST", "/bulk-dapa.php", payload, headers)
        res = conn.getresponse()
        data = res.read().decode("utf-8")
        
        response_json = json.loads(data)
        
        if response_json.get("success") and response_json.get("results"):
            item = response_json["results"][0]
            metrics = item.get("response", {}).get("data", {})
            
            da = metrics.get("da", 0)
            pa = metrics.get("pa", 0)
            dr = metrics.get("dr", 0)
            spam_score = metrics.get("spam_score", 0)
            org_traffic = metrics.get("org_traffic", 0)

            return {
                "status": "success",
                "domain": domain,
                "da": da,
                "pa": pa,
                "dr": dr,
                "spam_score": f"{spam_score}%" if isinstance(spam_score, (int, float)) else str(spam_score),
                "org_traffic": org_traffic,
                "raw_response": response_json
            }
        else:
            return {
                "status": "error",
                "domain": domain,
                "error": response_json.get("message", "Could not retrieve metrics from API response."),
                "raw_response": data
            }
    except Exception as e:
        return {"status": "error", "domain": domain, "error": f"Failed to connect: {str(e)}"}
    finally:
        conn.close()


import pycountry

def get_country_display_name(code: str) -> str:
    """Dynamically resolve 2-letter ISO country code to full country name."""
    code_upper = code.strip().upper()
    try:
        match = pycountry.countries.get(alpha_2=code_upper)
        if match:
            return f"{match.name} [{code_upper}]"
    except Exception:
        pass
    return COUNTRY_NAMES.get(code.strip().lower(), f"{code_upper} Database")


from concurrent.futures import ThreadPoolExecutor, as_completed

def extract_tld_country(domain: str) -> str:
    """Extract country code from domain TLD (e.g., azerbaijan.az -> az, brand.co.uk -> uk)."""
    parts = domain.lower().strip().split('.')
    if len(parts) > 1:
        tld = parts[-1]
        if len(tld) == 2 and tld not in ['com', 'org', 'net', 'edu', 'gov', 'biz']:
            return tld
        if len(parts) > 2 and len(parts[-2]) == 2:
            return parts[-2]
    return None


import time

def fetch_seranking_regional_traffic(target_info: dict, regions: list = None, api_key: str = None) -> list:
    """
    Fetch traffic breakdown dynamically across all top global databases using SE Ranking API.
    Always includes home country TLD detection + high speed concurrent database lookup.
    """
    if not api_key:
        api_key = SERANKING_API_KEY

    domain = target_info['domain']

    # Candidate pool covering all major regional search markets globally
    tld_country = extract_tld_country(domain)
    candidate_pool = ["us", "in", "uk", "ru", "tr", "de", "fr", "ge", "kz", "ca", "au", "br", "es", "it", "jp", "sg", "ae", "nl", "mx", "id", "sa", "eg", "za", "pl", "se", "ch", "at", "be", "no", "az"]
    
    if tld_country:
        if tld_country in candidate_pool:
            candidate_pool.remove(tld_country)
        candidate_pool.insert(0, tld_country)

    if regions and isinstance(regions, list):
        for r in regions:
            r_clean = str(r).strip().lower()
            if r_clean and r_clean not in candidate_pool:
                candidate_pool.append(r_clean)

    regions = candidate_pool

    url = f"{SERANKING_BASE_URL}/domain/overview/db"
    headers = {
        "Authorization": f"Token {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

    def fetch_single_region(region_code_str):
        code = region_code_str.strip().lower()
        full_url = f"{url}?domain={quote(domain)}&source={code}&with_subdomains=1"
        req = Request(full_url, headers=headers)
        
        for attempt in range(3):
            try:
                with urlopen(req, timeout=6) as resp:
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

                    total_t = org_traffic + paid_traffic
                    if total_t > 0 or org_kw > 0:
                        return {
                            "region_code": code.upper(),
                            "country": get_country_display_name(code),
                            "organic_traffic": org_traffic,
                            "paid_traffic": paid_traffic,
                            "total_traffic": total_t,
                            "organic_keywords": org_kw,
                            "paid_keywords": paid_kw
                        }
                    return None
            except Exception:
                time.sleep(0.3 * (attempt + 1))
        return None

    results = []
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(fetch_single_region, r) for r in regions]
        for future in as_completed(futures):
            res = future.result()
            if res:
                results.append(res)

    # Sort dynamically in descending order of traffic
    results.sort(key=lambda x: x.get("total_traffic", 0), reverse=True)
    return results


def format_number(val) -> str:
    if val is None:
        return "-"
    if not isinstance(val, (int, float)):
        return str(val)
    if val >= 1_000_000:
        return f"{val / 1_000_000:.1f}M ({val:,})"
    elif val >= 1_000:
        return f"{val / 1_000:.1f}K ({val:,})"
    return f"{val:,}"


def check_domain_metrics(link_input: str, rapidapi_key: str = None, regions: list = None, mock: bool = False) -> dict:
    """
    Analyze a URL/domain:
    - DA, PA, DR, Spam Score, AND Total Traffic STRICTLY from RapidAPI.
    - Dynamic Regional Traffic Breakdown strictly from SE Ranking API.
    """

    target_info = parse_target(link_input)
    da_data = fetch_rapidapi_da_metrics(target_info, rapidapi_key=rapidapi_key)
    regional_data = fetch_seranking_regional_traffic(target_info, regions=regions)

    da = da_data.get("da", 0) if isinstance(da_data, dict) else 0
    pa = da_data.get("pa", 0) if isinstance(da_data, dict) else 0
    dr = da_data.get("dr", 0) if isinstance(da_data, dict) else 0
    ss = da_data.get("spam_score", "0%") if isinstance(da_data, dict) else "0%"
    
    # RapidAPI Total Organic Traffic used for main traffic & totalTraffic (fallback to SE Ranking sum if None/0)
    org_traffic_val = da_data.get("org_traffic", 0) if isinstance(da_data, dict) else 0
    
    # Calculate SE Ranking regional sum & max single region traffic
    regional_sum = sum(r.get("total_traffic", 0) for r in regional_data if isinstance(r, dict))
    max_single_region_traffic = max((r.get("total_traffic", 0) for r in regional_data if isinstance(r, dict)), default=0)

    # Ensure total traffic is never lower than a single region's traffic or regional sum
    final_traffic_val = max(org_traffic_val or 0, max_single_region_traffic, regional_sum)
    formatted_main_traffic = format_number(final_traffic_val)

    # Format Top 3 Regions from SE Ranking purely for regional breakdown
    valid_regions = [r for r in regional_data if isinstance(r, dict) and r.get("total_traffic", 0) > 0]
    valid_regions.sort(key=lambda x: x.get("total_traffic", 0), reverse=True)
    top_3_regions = valid_regions[:3]
    
    def format_reg_str(reg_item):
        code = reg_item.get("region_code", "")
        t_val = reg_item.get("total_traffic", 0)
        return f"{code}: {format_number(t_val)}"

    reg1_str = format_reg_str(top_3_regions[0]) if len(top_3_regions) > 0 else "-"
    reg2_str = format_reg_str(top_3_regions[1]) if len(top_3_regions) > 1 else "-"
    reg3_str = format_reg_str(top_3_regions[2]) if len(top_3_regions) > 2 else "-"

    return {
        "url": target_info["full_url"],
        "domain": target_info["domain"],
        "da": da,
        "pa": pa,
        "dr": dr,
        "ss": ss,
        "traffic": formatted_main_traffic,
        "totalTraffic": formatted_main_traffic,
        "region1Traffic": reg1_str,
        "region2Traffic": reg2_str,
        "region3Traffic": reg3_str,
        "da_metrics": da_data,
        "traffic_data": regional_data
    }


def print_cli_report(target_info: dict, da_data: dict, regional_data: list = None):
    border = "=" * 75
    sub_border = "-" * 75

    print(f"\n{border}")
    print(f" DOMAIN METRICS & REGIONAL TRAFFIC REPORT")
    print(f"{border}")
    print(f" Target Input  : {target_info['raw_input']}")
    print(f" Target Domain : {target_info['domain']}")
    print(f"{sub_border}")

    if da_data.get("status") == "error":
        print(f" [!] RapidAPI Status : Error")
        print(f" [!] Error Msg       : {da_data.get('error')}")
    else:
        print(f"  * Domain Authority (DA) : {da_data.get('da', 'N/A')}")
        print(f"  * Page Authority (PA)   : {da_data.get('pa', 'N/A')}")
        print(f"  * Domain Rating (DR)    : {da_data.get('dr', 'N/A')}")
        print(f"  * Spam Score            : {da_data.get('spam_score', 'N/A')}")
        print(f"  * Total Organic Traffic : {format_number(da_data.get('org_traffic', 0))} [from RapidAPI]")

    if regional_data:
        print(f"\n REGIONAL TRAFFIC BREAKDOWN (via SE Ranking)")
        print(f" {sub_border}")
        print(f" {'Region / Country':<25} | {'Organic Traffic':<18} | {'Paid Traffic':<15}")
        print(f" {'-'*25}-+-{'-'*18}-+-{'-'*15}")

        for row in regional_data:
            country_display = row.get("country", row.get("region_code"))
            org_t = row.get("organic_traffic", 0)
            paid_t = row.get("paid_traffic", 0)
            print(f" {country_display:<25} | {format_number(org_t):<18} | {format_number(paid_t):<15}")

    print(f"{border}\n")


def main():
    parser = argparse.ArgumentParser(description="Domain Metrics & Regional Traffic Checker")
    parser.add_argument("domain", nargs="?", help="Target URL or domain (e.g., example.com)")
    parser.add_argument("--rapidapi-key", default=RAPIDAPI_KEY, help="RapidAPI Key")
    parser.add_argument("-r", "--regions", default="in,us,uk,ca,au", help="Comma-separated region codes")
    parser.add_argument("--json", action="store_true", help="Output raw JSON response")
    
    args = parser.parse_args()

    target_domain = args.domain
    if not target_domain:
        target_domain = input("Enter domain or URL (e.g. github.com): ").strip()
        if not target_domain:
            target_domain = "github.com"

    target_info = parse_target(target_domain)
    da_data = fetch_rapidapi_da_metrics(target_info, rapidapi_key=args.rapidapi_key)
    regions_list = [r.strip().lower() for r in args.regions.split(",") if r.strip()]
    regional_data = fetch_seranking_regional_traffic(target_info, regions_list)

    if args.json:
        full_result = {
            "target": target_info,
            "da_metrics": da_data,
            "regional_traffic": regional_data
        }
        print(json.dumps(full_result, indent=2))
    else:
        print_cli_report(target_info, da_data, regional_data)


if __name__ == "__main__":
    main()
