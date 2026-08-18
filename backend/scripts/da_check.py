import http.client
import json
import sys
from urllib.parse import urlparse

def extract_domain(input_url: str) -> str:
    """Extract clean domain name from URL or domain string."""
    input_url = input_url.strip()
    if not input_url.startswith(("http://", "https://")):
        input_url = "https://" + input_url
    
    parsed = urlparse(input_url)
    domain = parsed.netloc or parsed.path
    if domain.startswith("www."):
        domain = domain[4:]
    return domain.split(":")[0]

def get_da_metrics(domain: str):
    """Fetch DA/PA metrics using RapidAPI bulk-da-pa-checker2."""
    conn = http.client.HTTPSConnection("bulk-da-pa-checker2.p.rapidapi.com")
    payload = f"domains={domain}"
    
    headers = {
        'x-rapidapi-key': "9d27d2418bmsh49f11b032161487p1fb7c7jsn267454df8fe9",
        'x-rapidapi-host': "bulk-da-pa-checker2.p.rapidapi.com",
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
            
            print(f"\nDomain Authority (DA): {metrics.get('da', 'N/A')}")
            print(f"Page Authority (PA): {metrics.get('pa', 'N/A')}")
            print(f"Domain Rating (DR): {metrics.get('dr', 'N/A')}")
            print(f"Spam Score: {metrics.get('spam_score', 'N/A')}%")
            print(f"Organic Traffic: {metrics.get('org_traffic', 'N/A')}")
        else:
            print("Error: Could not retrieve metrics from API response.")
            print(f"Raw Response: {data}")

    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    if len(sys.argv) > 1:
        target = sys.argv[1]
    else:
        target = input("Enter website URL or domain: ")
        
    domain = extract_domain(target)
    print(f"Checking metrics for domain: {domain}...")
    get_da_metrics(domain)