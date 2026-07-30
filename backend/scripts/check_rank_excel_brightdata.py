
import sys
import os
import time
import argparse
import pandas as pd
from dotenv import load_dotenv

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(backend_dir)
load_dotenv(os.path.join(backend_dir, ".env"))

from services import rank_checker, category_checker


def process_excel_brightdata(input_path, output_path, country_code="in"):
    if not os.path.exists(input_path):
        print(f"Error: Input file '{input_path}' not found.")
        return

    country_code = category_checker.resolve_country_code(country_code) or "in"

    print(f"Reading input file: {input_path}")
    df = pd.read_excel(input_path)

    kw_col = None
    url_col = None

    for col in df.columns:
        col_lower = str(col).strip().lower()
        if col_lower in ["keyword", "keywords", "kw"]:
            kw_col = col
        elif col_lower in ["landing page", "target url", "url", "landing_page", "domain"]:
            url_col = col

    if not kw_col:
        print("Error: Could not find 'Keyword' column in Excel file.")
        return

    print(f"Using Keyword column: '{kw_col}'")
    if url_col:
        print(f"Using Target URL column: '{url_col}'")

    ranks = []
    found_urls = []

    print("\nStarting Bright Data Rank Checker...\n")

    for idx, row in df.iterrows():
        kw = str(row[kw_col]).strip() if pd.notna(row[kw_col]) else ""
        target_url = str(row[url_col]).strip() if url_col and pd.notna(row[url_col]) else ""

        if not kw:
            ranks.append("")
            found_urls.append("")
            continue

        print(f"[{idx + 1}/{len(df)}] Checking Rank via Bright Data for: '{kw}' (Target: {target_url or 'Any'})...")
        
        try:
            rank, matched_links = rank_checker.find_rank(
                kw, target_url, default_domain=rank_checker.get_domain(target_url), country_code=country_code
            )
            matched_url = matched_links[0] if matched_links else None
            
            # If rank is None or not found, use 101
            final_rank = rank if rank is not None else 101
            
            print(f"    -> Rank: {final_rank} | Matched URL: {matched_url or 'None'}")
            ranks.append(final_rank)
            found_urls.append(matched_url or "")
        except Exception as e:
            print(f"    -> Error checking rank: {e}")
            ranks.append(101)
            found_urls.append("")

        time.sleep(0.5)

        # Save intermediate progress every 10 rows
        if (idx + 1) % 10 == 0 or (idx + 1) == len(df):
            df_temp = df.copy()
            df_temp["Checked Rank"] = ranks + [""] * (len(df) - len(ranks))
            df_temp["Matched Ranking URL"] = found_urls + [""] * (len(df) - len(found_urls))
            df_temp.to_excel(output_path, index=False)

    print(f"\nCompleted successfully! All results saved to: {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Check Google keyword rankings via Bright Data API.")
    parser.add_argument("--input", default="Book1.xlsx", help="Path to input Excel file")
    parser.add_argument("--output", default="Book1_brightdata_ranked.xlsx", help="Path to output Excel file")
    parser.add_argument("--country", default="in", help="2-letter country code for Google search (default: in)")

    args = parser.parse_args()
    process_excel_brightdata(args.input, args.output, country_code=args.country)
