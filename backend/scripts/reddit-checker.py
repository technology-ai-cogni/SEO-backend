from typing import Tuple, Dict, Any, Optional, List
import os
import csv
import json
import time
import asyncio
import re
import http.client
import urllib.parse
import ssl
import urllib.request
from dotenv import load_dotenv
from urllib.parse import urlparse
from openai import AsyncOpenAI

load_dotenv()

# Initialize OpenAI client
openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# RapidAPI config
RAPIDAPI_KEY = os.environ.get("RAPIDAPI_KEY", "195a535aa7msha4f34dda9c1273dp1ba1eajsnaa8b48b85119")
RAPIDAPI_HOST = "reddit34.p.rapidapi.com"


def normalize_reddit_url(url):
    """Normalize Reddit URLs by extracting the post path (subreddit + post ID + slug)."""
    if not url or not isinstance(url, str):
        return None
    try:
        parsed = urlparse(url)
        if "reddit.com" not in parsed.netloc and "redd.it" not in parsed.netloc:
            return None
        path = parsed.path.strip('/')
        return path
    except Exception:
        return None


def extract_comment_id_from_url(url):
    """Extract the specific comment ID from a Reddit comment permalink URL.
    e.g. https://www.reddit.com/r/sub/comments/abc123/title/def456/ -> def456
    """
    if not url or not isinstance(url, str):
        return None
    try:
        parsed = urlparse(url)
        path = parsed.path.strip('/')
        parts = path.split('/')
        # Reddit comment URLs: r/<sub>/comments/<post_id>/<slug>/<comment_id>
        if len(parts) >= 6 and parts[0] == 'r' and parts[2] == 'comments':
            return parts[5]
        return None
    except Exception:
        return None


def parse_upvote_val(val):
    """Parse upvote value string (e.g. '1.2K', '500') into integer."""
    if not val:
        return 0
    val_str = str(val).strip().upper()
    try:
        match = re.search(r'([\d\.]+[KMBkmb]?)', val_str)
        if match:
            v = match.group(1).upper()
            if 'K' in v:
                return int(float(v.replace('K', '')) * 1000)
            if 'M' in v:
                return int(float(v.replace('M', '')) * 1000000)
            return int(float(v))
        if 'K' in val_str:
            return int(float(val_str.replace('K', '')) * 1000)
        if 'M' in val_str:
            return int(float(val_str.replace('M', '')) * 1000000)
        return int(float(val_str))
    except Exception:
        return 0


def evaluate_reddit_status_and_remarks(topic_error, scraped_comments, our_comment, our_rank, landing_page="", landing_domain="", post_deleted=False, comment_deleted=False):
    """
    Evaluates Reddit thread check results and returns (status, remarks, solution).
    Mirrors evaluate_quora_status_and_remarks() logic exactly.
    Collects ALL detected issues into remarks.
    """
    # 1. Post/Comment Deleted Check
    if post_deleted or comment_deleted or topic_error:
        return "Audited-LQ", "Answer Deleted", "Quora : Reddit- Post New Answer"

    issues = []

    # 2. Not in Top 3 Check (If our comment is missing or ranked > 3)
    if not our_comment or not our_rank or our_rank > 3:
        issues.append("Not in Top3")

    # 3. Upvotes comparison with top 3 comments
    top3_comments = scraped_comments[:3] if scraped_comments else []
    top3_upvote_vals = [parse_upvote_val(c.get("comment_upvotes") or c.get("upvotes")) for c in top3_comments]
    max_top3_upvotes = max(top3_upvote_vals) if top3_upvote_vals else 0

    our_upvotes = parse_upvote_val(our_comment.get("comment_upvotes") or our_comment.get("upvotes", "0")) if our_comment else 0

    print(f"[Reddit Audit] [Upvote Metrics] Our Rank: {our_rank or 'Not Found'} | Our Upvotes: {our_upvotes} | Top 3 Max Upvotes: {max_top3_upvotes}", flush=True)

    if our_upvotes == 0:
        issues.append("No upvotes")
    elif our_upvotes < max_top3_upvotes:
        issues.append("Less upvotes")

    # 4. Brand Mention
    if our_comment:
        comment_text = our_comment.get("comment_body") or our_comment.get("text") or ""
        comment_text_lower = comment_text.lower()

        brand_mentioned = False
        if landing_domain and landing_domain in comment_text_lower:
            brand_mentioned = True
        elif landing_page and landing_page.lower() in comment_text_lower:
            brand_mentioned = True

        if not brand_mentioned:
            issues.append("No Brand Mention")

        # 5. Low Content check
        words = comment_text.split()
        word_count = len(words)
        top3_word_counts = [len((c.get("comment_body") or c.get("text") or "").split()) for c in top3_comments if (c.get("comment_body") or c.get("text"))]
        avg_top3_words = (sum(top3_word_counts) / len(top3_word_counts)) if top3_word_counts else 0

        if word_count < 30 or (avg_top3_words > 0 and word_count < 0.4 * avg_top3_words):
            issues.append("Low content")

    if issues:
        remarks_str = ", ".join(issues)
        solution = "Quora : Reddit- Add More Upvotes"
        if "Not in Top3" in issues:
            solution = "Quora : Reddit- Add More Upvotes"
        elif "No Brand Mention" in issues or "Low content" in issues:
            solution = "Content Replace"
        return "Audited-LQ", remarks_str, solution

    # Everything is fine!
    return "Audited-Indexed", "Indexed", "No issues"


def fetch_post_comments_via_api(url: str) -> dict:
    """
    Fetch post details + all comments for a Reddit URL using the Reddit34 RapidAPI.
    Returns the raw JSON response from the API.
    """
    conn = http.client.HTTPSConnection(RAPIDAPI_HOST)
    headers = {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_HOST,
        'Content-Type': 'application/json'
    }

    encoded_url = urllib.parse.quote(url, safe='')
    conn.request("GET", f"/getPostComments?post_url={encoded_url}", headers=headers)

    res = conn.getresponse()
    data = res.read()
    conn.close()
    return json.loads(data.decode("utf-8"))


def _flatten_comments(children: list, depth: int = 0) -> list:
    """
    Recursively flatten the nested Reddit comment tree into a flat list.
    Each comment gets a 'depth' field indicating its nesting level.
    """
    flat = []
    for child in children:
        if child.get("kind") != "t1":
            continue
        c = child.get("data", {})

        flat.append({
            "comment_id": c.get("id", ""),
            "comment_author": c.get("author", "[deleted]"),
            "comment_upvotes": c.get("score", 0) or 0,
            "comment_body": c.get("body", ""),
            "comment_url": f"https://www.reddit.com{c['permalink']}" if c.get("permalink") else "",
            "depth": c.get("depth", depth),
        })

        # Recurse into nested replies
        replies = c.get("replies")
        if isinstance(replies, dict):
            reply_children = replies.get("data", {}).get("children", [])
            flat.extend(_flatten_comments(reply_children, depth + 1))

    return flat


def scrape_reddit_with_api(url: str) -> dict:
    """
    Use the Reddit34 RapidAPI to get post info, upvotes, and comments
    for a given Reddit post URL. Returns structured data.
    """
    response = fetch_post_comments_via_api(url)

    if not response.get("success"):
        raise ValueError(f"API error: {response.get('data', 'Unknown error')}")

    data = response["data"]

    # First element contains the post info
    post_data = data[0]["data"]["children"][0]["data"]
    post_info = {
        "post_id": post_data.get("id", ""),
        "post_title": post_data.get("title", ""),
        "post_author": post_data.get("author", ""),
        "post_upvotes": post_data.get("score", 0) or 0,
        "total_comment_count": post_data.get("num_comments", 0) or 0,
        "post_content": post_data.get("selftext", "") or "(No body text / Media Post)",
        "subreddit": post_data.get("subreddit_name_prefixed", ""),
        "permalink": f"https://www.reddit.com{post_data.get('permalink', '')}" if post_data.get("permalink") else url,
        "is_removed": post_data.get("removed_by_category") is not None,
        "is_deleted": post_data.get("author") == "[deleted]" and not post_data.get("selftext"),
    }

    # Second element contains the comment tree
    comment_children = data[1]["data"]["children"] if len(data) > 1 else []
    all_comments = _flatten_comments(comment_children)

    return {
        "source_url": url,
        "post": post_info,
        "all_comments": all_comments,
        "error": None,
    }


def check_reddit_comment_deleted(all_comments: list, target_comment_id: str) -> bool:
    """
    Check if a specific comment is deleted or removed.
    """
    if not target_comment_id:
        return False

    for comment in all_comments:
        if comment.get("comment_id") == target_comment_id:
            author = comment.get("comment_author", "")
            body = comment.get("comment_body", "")
            if author in ("[deleted]", "[removed]") or body in ("[deleted]", "[removed]"):
                return True
            return False

    # Comment not found in the thread at all - consider it deleted
    return True


def check_reddit_http_fallback(live_link: str, topic: str = "", landing_page: str = "") -> Tuple[str, str, str]:
    """
    Lightweight HTTP fallback check for Reddit links when API is unavailable.
    """
    check_url = live_link if (live_link and live_link.startswith("http")) else topic
    if not check_url or not check_url.startswith("http"):
        return "Audited-LQ", "Flagged-Indexation", "Quora : Reddit- Post New Answer"

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }

    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        req = urllib.request.Request(check_url, headers=headers)
        with urllib.request.urlopen(req, context=ctx, timeout=12) as resp:
            status_code = resp.getcode()
            if status_code in [404, 410]:
                return "Audited-LQ", "Answer Deleted", "Quora : Reddit- Post New Answer"

            raw_bytes = resp.read()
            html_text = raw_bytes.decode('utf-8', errors='ignore')

            if "[deleted]" in html_text or "[removed]" in html_text or "page not found" in html_text.lower():
                return "Audited-LQ", "Answer Deleted", "Quora : Reddit- Post New Answer"

            landing_domain = landing_page.replace("https://", "").replace("http://", "").replace("www.", "").split("/")[0].lower() if landing_page else ""
            html_lower = html_text.lower()

            if landing_domain and landing_domain in html_lower:
                return "Audited-Indexed", "Indexed", "No issues"
            else:
                return "Audited-LQ", "Not in Top3, No upvotes", "Quora : Reddit- Add More Upvotes"

    except Exception as e:
        print(f"[Reddit HTTP Check Notice] {check_url}: {e}")
        return "Audited-LQ", "Not in Top3, No upvotes", "Quora : Reddit- Add More Upvotes"


async def analyze_gap(topic, top_comment, our_comment):
    """Use OpenAI to compare the top comment with our comment on Reddit."""
    prompt = f"""You are an SEO and Reddit marketing expert.
We are analyzing why our comment on a Reddit post is ranked lower than the top comment.

Topic/Post Title: {topic}

=== TOP COMMENT (Rank 1) ===
Upvotes: {top_comment.get('comment_upvotes') or top_comment.get('upvotes', '0')}
Text (truncated):
{(top_comment.get('comment_body') or top_comment.get('text', ''))[:1500]}

=== OUR COMMENT ===
Upvotes: {our_comment.get('comment_upvotes') or our_comment.get('upvotes', '0')}
Text (truncated):
{(our_comment.get('comment_body') or our_comment.get('text', ''))[:1500]}

Analyze the difference. Why is our comment ranked lower? Is it primarily because of the upvote count, or is there a noticeable quality/formatting/detail gap? Be concise and actionable (max 4 sentences)."""

    try:
        response = await openai_client.chat.completions.create(
            model=os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt}],
            max_tokens=250,
            temperature=0.5
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        return f"LLM Analysis failed: {str(e)}"


async def analyze_content_to_add(topic, top_comment, our_comment, kw1="", landing_domain=""):
    """
    Analyzes what content to add to our Reddit comment (strictly max 15 words).
    """
    top_text = (top_comment.get("comment_body") or top_comment.get("text", "")).strip() if top_comment else ""
    our_text = (our_comment.get("comment_body") or our_comment.get("text", "")).strip() if our_comment else ""
    top_upvotes = parse_upvote_val(top_comment.get("comment_upvotes") or top_comment.get("upvotes", 0)) if top_comment else 0
    our_upvotes = parse_upvote_val(our_comment.get("comment_upvotes") or our_comment.get("upvotes", 0)) if our_comment else 0

    if os.getenv("OPENAI_API_KEY") and openai_client:
        prompt = f"""Reddit Post: "{topic}"
Target Keyword: "{kw1}"
Rank 1 Comment: {top_text[:500]}
Our Comment: {our_text[:500]}

Specify what content to add to beat Rank 1. STRICT REQUIREMENT: Max 12 words."""
        try:
            res = await openai_client.chat.completions.create(
                model=os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini"),
                messages=[{"role": "user", "content": prompt}],
                max_tokens=60,
                temperature=0.3
            )
            analysis = res.choices[0].message.content.strip()
            if analysis:
                words = analysis.split()
                return " ".join(words[:15])
        except Exception as e:
            print(f"[reddit-checker] LLM gap analysis notice: {e}")

    top_words = len(top_text.split())
    our_words = len(our_text.split())

    if kw1 and kw1.lower() not in our_text.lower():
        advice = f"Add target keyword '{kw1}' and bullet points to match Rank #1."
    elif top_upvotes > our_upvotes:
        advice = f"Add {top_upvotes - our_upvotes} upvotes and expand explanation to match Rank #1."
    elif our_words < top_words:
        advice = f"Add ~{top_words - our_words} words covering key details from Rank #1 comment."
    elif landing_domain and landing_domain not in our_text.lower():
        advice = f"Include brand reference for {landing_domain} with structural subheadings."
    else:
        advice = "Add comparison tables, updated facts, and clear bullet points."

    words = advice.split()
    return " ".join(words[:15])


async def do_reddit_single_audit(topic, live_link, landing_page):
    """
    Single Reddit row audit: fetch post+comments via API, find our comment, evaluate status.
    This is the main entry point called from app.py.
    Returns (status, remarks, solution).
    """
    landing_domain = landing_page.replace("https://", "").replace("http://", "").replace("www.", "").split("/")[0].lower() if landing_page else ""

    # Determine the post URL to scrape (strip comment-level path to get the post URL)
    post_url = live_link if live_link and live_link.startswith("http") else topic
    if not post_url or not post_url.startswith("http"):
        return "Audited-LQ", "Flagged-Indexation", "Quora : Reddit- Post New Answer"

    # Extract our target comment ID from the live link
    target_comment_id = extract_comment_id_from_url(live_link)

    # Strip comment ID from URL to get the post-level URL for API call
    clean_post_url = post_url
    if target_comment_id:
        clean_post_url = post_url.split('?')[0].rstrip('/')
        parts = clean_post_url.split('/')
        if len(parts) >= 7 and parts[-1] == target_comment_id:
            clean_post_url = '/'.join(parts[:-1]) + '/'

    try:
        print(f"[Reddit Checker] Fetching post data via API: {clean_post_url}", flush=True)
        scrape_result = scrape_reddit_with_api(clean_post_url)
    except Exception as e:
        print(f"[Reddit Checker] API error: {e}", flush=True)
        return check_reddit_http_fallback(live_link, topic, landing_page)

    post_info = scrape_result.get("post", {})
    all_comments = scrape_result.get("all_comments", [])

    # Check if post itself is deleted/removed
    post_deleted = post_info.get("is_removed", False) or post_info.get("is_deleted", False)
    if post_deleted:
        print(f"[Reddit Checker] Post is deleted/removed.", flush=True)
        return "Audited-LQ", "Answer Deleted", "Quora : Reddit- Post New Answer"

    # Check if our specific comment is deleted
    comment_deleted = False
    if target_comment_id:
        comment_deleted = check_reddit_comment_deleted(all_comments, target_comment_id)
        if comment_deleted:
            print(f"[Reddit Checker] Our comment {target_comment_id} is deleted/removed.", flush=True)

    if not all_comments and not comment_deleted:
        print(f"[Reddit Checker] No comments found via API. Falling back to HTTP check.", flush=True)
        return check_reddit_http_fallback(live_link, topic, landing_page)

    # Sort top-level comments by upvotes (descending) for ranking
    top_level_comments = [c for c in all_comments if c.get("depth", 0) == 0]
    top_level_comments.sort(key=lambda x: parse_upvote_val(x.get("comment_upvotes", 0)), reverse=True)

    # Find our comment
    our_comment = None
    our_rank = None

    if not comment_deleted:
        # Try matching by comment ID first
        if target_comment_id:
            for idx, comment in enumerate(top_level_comments):
                if comment.get("comment_id") == target_comment_id:
                    our_comment = comment
                    our_rank = idx + 1
                    break

            # Also check non-top-level comments if not found in top-level
            if not our_comment:
                for comment in all_comments:
                    if comment.get("comment_id") == target_comment_id:
                        our_comment = comment
                        our_rank = None  # Not in top-level, so no rank
                        break

        # Fallback: Match by landing page / brand mention in comment body
        if not our_comment and landing_page:
            for idx, comment in enumerate(top_level_comments):
                body_lower = (comment.get("comment_body") or "").lower()
                if landing_domain and landing_domain in body_lower:
                    our_comment = comment
                    our_rank = idx + 1
                    break
                elif landing_page.lower() in body_lower:
                    our_comment = comment
                    our_rank = idx + 1
                    break

        # Fallback: Match by live link URL substring in comment URL
        if not our_comment and live_link:
            live_lower = live_link.lower().rstrip('/')
            for idx, comment in enumerate(top_level_comments):
                comment_url = (comment.get("comment_url") or "").lower().rstrip('/')
                if comment_url and (live_lower in comment_url or comment_url in live_lower):
                    our_comment = comment
                    our_rank = idx + 1
                    break

    # Evaluate status using the same logic as Quora
    status, remarks, solution = evaluate_reddit_status_and_remarks(
        None,  # topic_error
        top_level_comments,
        our_comment,
        our_rank,
        landing_page,
        landing_domain,
        post_deleted,
        comment_deleted
    )

    if our_comment:
        print(f"[Reddit Checker] -> Our comment found at Rank {our_rank} (Upvotes: {our_comment.get('comment_upvotes')}) | Status: {status} | Remarks: {remarks}", flush=True)
    else:
        print(f"[Reddit Checker] -> Our comment not found. Status: {status} | Remarks: {remarks}", flush=True)

    return status, remarks, solution


async def main():
    import argparse
    parser = argparse.ArgumentParser(description="Reddit Topic and Live Link Checker")
    parser.add_argument("--csv", default="offpage_scheduler_template (5).csv", help="Path to input CSV file")
    parser.add_argument("--out", default="reddit_checker_results.json", help="Path to output JSON file")
    parser.add_argument("--limit", type=int, default=50, help="Limit number of rows to process")

    args = parser.parse_args()
    input_csv = args.csv
    output_json = args.out
    limit = args.limit

    results = []
    print(f"Reading {input_csv} (Processing up to {limit} dataset rows)...")

    try:
        with open(input_csv, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            processed_count = 0
            for idx, row in enumerate(reader):
                if limit and processed_count >= limit:
                    break
                activity = row.get('Activity Name', '').strip()
                topic = row.get('Topic', '').strip()
                live = row.get('Live Link', '').strip()

                # Process if it's a Reddit URL in Topic, Live Link, or Activity
                if not ('reddit' in activity.lower() or 'reddit.com' in topic.lower() or 'reddit.com' in live.lower()):
                    continue

                processed_count += 1

                row_result = {
                    "UID": row.get("UID", ""),
                    "Keyword 1": row.get("Keyword 1", ""),
                    "Landing Page": row.get("Landing Page", ""),
                    "Cluster": row.get("Cluster", ""),
                    "Activity Name": activity,
                    "Topic": topic,
                    "Live Link": live,
                    "Is Present": False,
                    "Rank": None,
                    "Our Upvotes": None,
                    "Top Comment Upvotes": None,
                    "LLM Analysis": None,
                    "Error": None,
                }

                landing_page = row.get("Landing Page", "").strip()

                print(f"\n[{idx+1}] Processing Reddit: {live or topic}")

                try:
                    status, remarks, solution = await do_reddit_single_audit(topic, live, landing_page)
                    row_result["Status"] = status
                    row_result["Remarks"] = remarks
                    row_result["Solution"] = solution

                    if status == "Audited-Indexed":
                        row_result["Is Present"] = True

                except Exception as e:
                    print(f"Error processing row: {e}")
                    row_result["Error"] = str(e)
                    row_result["Status"] = "Audited-LQ"
                    row_result["Remarks"] = "Not in Top3, No upvotes"
                    row_result["Solution"] = "Quora : Reddit- Add More Upvotes"

                results.append(row_result)

                # Write continuously to output JSON file
                with open(output_json, 'w', encoding='utf-8') as out_f:
                    json.dump(results, out_f, indent=4)

                time.sleep(1.5)

    except FileNotFoundError:
        print(f"Error: Could not find the file {input_csv}")
    except Exception as e:
        print(f"An error occurred: {str(e)}")

    print(f"\nDone! Reddit checking complete. Saved to {output_json}")

if __name__ == "__main__":
    asyncio.run(main())
