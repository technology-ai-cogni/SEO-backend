import os
import csv
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

# Load env variables
load_dotenv()

# Add backend directory to sys.path so we can import services
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services import rank_checker

# Lock for writing to CSV incrementally
write_lock = threading.Lock()

def process_row(row, output_path, headers):
    keyword = row.get("Keyword")
    landing_page = row.get("Page")
    if not keyword:
        return None
    
    try:
        rank, matched_links = rank_checker.find_rank(
            keyword=keyword,
            landing_page=landing_page,
            default_domain=None,
            country_code=None
        )
        res = {
            "Keyword": keyword,
            "KW Volume": row.get("KW Volume", ""),
            "KD": row.get("KD", ""),
            "Page": landing_page,
            "Rank": rank,
            "Matched Links Count": len(matched_links),
            "Status": "Success",
            "Error": ""
        }
    except Exception as e:
        res = {
            "Keyword": keyword,
            "KW Volume": row.get("KW Volume", ""),
            "KD": row.get("KD", ""),
            "Page": landing_page,
            "Rank": rank_checker.NOT_FOUND_RANK,
            "Matched Links Count": 0,
            "Status": "Failed",
            "Error": str(e)
        }
        
    # Write incrementally with retries to handle Windows sharing violations
    for attempt in range(5):
        try:
            with write_lock:
                file_exists = os.path.exists(output_path) and os.path.getsize(output_path) > 0
                with open(output_path, mode="a", newline="", encoding="utf-8") as f:
                    writer = csv.DictWriter(f, fieldnames=headers)
                    if not file_exists:
                        writer.writeheader()
                    writer.writerow(res)
            break
        except OSError:
            if attempt == 4:
                print(f"[Error] Failed to write result to CSV for '{keyword}' after 5 attempts.", flush=True)
            else:
                time.sleep(0.5)
            
    return res

def main():
    input_path = os.path.join(backend_dir, "datasets", "testing_rank - Sheet1.csv")
    output_path = os.path.join(backend_dir, "datasets", "testing_rank_results.csv")
    
    if not os.path.exists(input_path):
        print(f"Error: Input file not found at {input_path}", flush=True)
        sys.exit(1)
        
    # Load completed keywords if the output file exists
    completed_keywords = set()
    headers = ["Keyword", "KW Volume", "KD", "Page", "Rank", "Matched Links Count", "Status", "Error"]
    
    if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
        try:
            with open(output_path, mode="r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for r in reader:
                    kw = r.get("Keyword")
                    if kw and r.get("Status") in ("Success", "Failed"):
                        completed_keywords.add(kw)
            print(f"Resuming run. Found {len(completed_keywords)} already processed keywords.", flush=True)
        except Exception as e:
            print(f"Error reading existing output file, starting fresh: {e}", flush=True)
            # If error, empty the file
            with open(output_path, mode="w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=headers)
                writer.writeheader()

    # If the output file doesn't exist, create it and write headers
    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        with open(output_path, mode="w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=headers)
            writer.writeheader()
        
    all_rows = []
    with open(input_path, mode="r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for r in reader:
            all_rows.append(r)
            
    # Filter out completed keywords
    rows_to_process = [r for r in all_rows if r.get("Keyword") not in completed_keywords]
    
    print(f"Loaded {len(all_rows)} total keywords. Remaining to process: {len(rows_to_process)}", flush=True)
    if not rows_to_process:
        print("All keywords have already been processed!", flush=True)
        return
        
    print("Starting rank checker using services.rank_checker (Bright Data)...", flush=True)
    
    # Using 30 workers for concurrency
    max_workers = 30
    
    start_time = time.time()
    completed = 0
    total_to_process = len(rows_to_process)
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(process_row, row, output_path, headers): row for row in rows_to_process}
        
        for future in as_completed(futures):
            try:
                res = future.result()
                if res:
                    completed += 1
                    print(f"[{completed}/{total_to_process}] '{res['Keyword']}' -> Rank: {res['Rank']} (Status: {res['Status']})", flush=True)
            except Exception as e:
                print(f"[Thread Error] Task execution failed: {e}", flush=True)
                
    print(f"Completed! Output written to {output_path}", flush=True)
    print(f"Total time taken for remaining items: {time.time() - start_time:.2f} seconds", flush=True)

if __name__ == "__main__":
    main()
