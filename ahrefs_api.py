#!/usr/bin/env python3
"""
WhoisXML API Integration (WhoisService)
---------------------------------------
Note: This script queries WhoisXML API (https://www.whoisxmlapi.com)
to fetch complete domain WHOIS records, registration dates, registrar details,
and contact/nameserver metadata.

Usage:
    python ahrefs_api.py [domain_or_url]
Example:
    python ahrefs_api.py https://www.euroschoolindia.com
"""

import sys
import os
import json
import urllib.parse
from typing import Dict, Any, Optional

import warnings
warnings.filterwarnings("ignore")

try:
    import requests
except ImportError:
    requests = None

# Default API Key (can be overridden by WHOISXML_API_KEY env variable)
DEFAULT_API_KEY = os.getenv("WHOISXML_API_KEY", "at_D8pEtFgUg7aWPMiyYeDvt0MNo8o0Z")
API_ENDPOINT = "https://www.whoisxmlapi.com/whoisserver/WhoisService"


def clean_domain(domain_or_url: str) -> str:
    """
    Extract domain name from a URL or raw string.
    e.g. 'https://www.euroschoolindia.com/about' -> 'euroschoolindia.com'
    """
    domain_or_url = domain_or_url.strip()
    if domain_or_url.startswith(("http://", "https://")):
        parsed = urllib.parse.urlparse(domain_or_url)
        domain = parsed.netloc
    else:
        domain = domain_or_url.split("/")[0]

    # Strip port if present
    domain = domain.split(":")[0]
    # Optionally strip 'www.' prefix for standard domain lookup
    if domain.lower().startswith("www."):
        domain = domain[4:]
    return domain


def get_whois_data(domain_or_url: str, api_key: Optional[str] = None) -> Dict[str, Any]:
    """
    Fetch WHOIS record for a domain from WhoisXML API.

    Args:
        domain_or_url: The domain name or full URL to inspect.
        api_key: WhoisXML API key. Defaults to DEFAULT_API_KEY.

    Returns:
        Dict containing the API response.
    """
    key = api_key or DEFAULT_API_KEY
    if not key:
        raise ValueError("API key must be provided or set via WHOISXML_API_KEY.")

    domain = clean_domain(domain_or_url)
    payload = {
        "domainName": domain,
        "apiKey": key,
        "outputFormat": "JSON"
    }

    if requests is not None:
        response = requests.post(API_ENDPOINT, json=payload, timeout=30)
        response.raise_for_status()
        return response.json()
    else:
        # Fallback using standard library urllib
        import urllib.request
        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            API_ENDPOINT,
            data=data_bytes,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))


def display_whois_summary(data: Dict[str, Any]) -> None:
    """Pretty print parsed WHOIS summary."""
    if "ErrorMessage" in data:
        print(f"\n[!] API Error: {data['ErrorMessage'].get('msg', data['ErrorMessage'])}")
        return

    record = data.get("WhoisRecord", {})
    if not record:
        print("\n[!] No WhoisRecord found in response.")
        print(json.dumps(data, indent=2))
        return

    print("=" * 60)
    print("           WHOIS DOMAIN LOOKUP REPORT")
    print("=" * 60)
    print(f"Domain Name          : {record.get('domainName', 'N/A')}")
    print(f"Domain Extension     : {record.get('domainNameExt', 'N/A')}")
    print(f"Domain Availability  : {record.get('domainAvailability', 'N/A')}")
    print(f"Estimated Age (days) : {record.get('estimatedDomainAge', 'N/A')}")
    print(f"Created Date         : {record.get('createdDate', 'N/A')}")
    print(f"Updated Date         : {record.get('updatedDate', 'N/A')}")
    print(f"Expires Date         : {record.get('expiresDate', 'N/A')}")
    print(f"Registrar Name       : {record.get('registrarName', 'N/A')}")
    print(f"Registrar IANA ID    : {record.get('registrarIANAID', 'N/A')}")
    print(f"Contact Email        : {record.get('contactEmail', 'N/A')}")
    print(f"Whois Server         : {record.get('whoisServer', 'N/A')}")

    # Registrant Info
    registrant = record.get("registrant", {})
    if registrant:
        print("-" * 60)
        print("Registrant Details:")
        print(f"  Name         : {registrant.get('name', 'N/A')}")
        print(f"  Organization : {registrant.get('organization', 'N/A')}")
        print(f"  Country      : {registrant.get('country', 'N/A')} ({registrant.get('countryCode', 'N/A')})")
        print(f"  State / City : {registrant.get('state', 'N/A')}, {registrant.get('city', 'N/A')}")

    # Name Servers
    name_servers = record.get("nameServers", {}).get("hostNames", [])
    if name_servers:
        print("-" * 60)
        print("Name Servers:")
        for ns in name_servers:
            print(f"  - {ns}")

    print("=" * 60)


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "https://www.euroschoolindia.com"
    print(f"Querying WhoisXML API for: {target} ...\n")
    try:
        result = get_whois_data(target)
        display_whois_summary(result)
        
        # Also print brief snippet of raw response structure
        print("\nFull JSON Keys returned:", list(result.keys()))
        if "WhoisRecord" in result:
            print("WhoisRecord Fields:", list(result["WhoisRecord"].keys()))
    except Exception as exc:
        print(f"\n[ERROR] Failed to query API: {exc}")
        sys.exit(1)