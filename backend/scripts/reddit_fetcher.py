"""
Reddit Data Fetcher (RapidAPI & Direct)
Fetches post details (title, username, upvotes, total comments) and comment details (author, upvotes, body)
from a single Reddit URL using RapidAPI key configured in .env.

Usage:
    python backend/scripts/reddit_fetcher.py "https://www.reddit.com/r/vadodara/comments/1gjwwoq/please_suggest_me_some_good_cbse_and_igcse/"
"""

import os
import re
import json
import requests
from urllib.parse import urlparse
from dotenv import load_dotenv

# Load environment variables
dotenv_path = os.path.join(os.path.dirname(__file__), "..", ".env")
if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path)
else:
    load_dotenv()

RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY", "")
# Default RapidAPI Reddit host (can be set in .env as RAPIDAPI_REDDIT_HOST)
RAPIDAPI_REDDIT_HOST = os.getenv("RAPIDAPI_REDDIT_HOST", "reddit34.p.rapidapi.com")


def clean_reddit_url(url: str) -> str:
    """Normalize and clean a Reddit post URL."""
    url = url.strip()
    parsed = urlparse(url)
    clean_path = parsed.path.rstrip('/')
    return f"https://www.reddit.com{clean_path}"


def extract_reddit_details_from_url(url: str) -> dict:
    """Extract subreddit and post ID from a Reddit URL."""
    url = url.strip()
    match = re.search(r"reddit\.com/r/([^/]+)/comments/([a-zA-Z0-9]+)", url)
    if match:
        return {
            "subreddit": match.group(1),
            "post_id": match.group(2)
        }
    match_post_id = re.search(r"/comments/([a-zA-Z0-9]+)", url)
    if match_post_id:
        return {
            "subreddit": "",
            "post_id": match_post_id.group(1)
        }
    return {"subreddit": "", "post_id": ""}


def fetch_via_rapidapi(url: str, api_key: str = RAPIDAPI_KEY, host: str = RAPIDAPI_REDDIT_HOST) -> dict:
    """
    Fetch Reddit post & comments data via RapidAPI.
    Supports reddit34.p.rapidapi.com and other RapidAPI Reddit endpoints.
    """
    if not api_key:
        raise ValueError("RAPIDAPI_KEY is not found in .env")

    headers = {
        "x-rapidapi-key": api_key,
        "x-rapidapi-host": host
    }

    url_info = extract_reddit_details_from_url(url)
    post_id = url_info.get("post_id", "")
    clean_url = clean_reddit_url(url)

    # Endpoints to try in order (reddit34 endpoint first)
    endpoints_to_try = [
        (f"https://{host}/getPostComments", {"post_url": clean_url}),
        (f"https://{host}/getPostComments", {"url": clean_url}),
        (f"https://{host}/post/comments", {"url": clean_url}),
        (f"https://{host}/comments", {"url": clean_url}),
        (f"https://{host}/get-comments", {"url": clean_url}),
        (f"https://{host}/comments", {"id": post_id} if post_id else {})
    ]

    last_error = None
    for endpoint, params in endpoints_to_try:
        if not endpoint:
            continue
        try:
            resp = requests.get(endpoint, headers=headers, params=params, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                # If wrapped in { success: true, data: [...] }
                if isinstance(data, dict) and "data" in data and isinstance(data["data"], (list, dict)):
                    parsed_result = _normalize_reddit_listing(data["data"], clean_url)
                    if parsed_result.get("post", {}).get("title"):
                        return parsed_result
                parsed_result = _normalize_reddit_listing(data, clean_url)
                if parsed_result.get("post", {}).get("title"):
                    return parsed_result
            else:
                last_error = f"HTTP {resp.status_code}: {resp.text[:150]}"
        except Exception as e:
            last_error = str(e)

    raise RuntimeError(f"RapidAPI request failed on host '{host}'. Error: {last_error}")


def _normalize_reddit_listing(data: any, url: str) -> dict:
    """Normalize standard Reddit listing array [post_listing, comments_listing] or object."""
    post_info = {}
    comments = []

    if isinstance(data, list) and len(data) >= 1:
        # Extract Post (usually index 0)
        try:
            first_children = data[0].get("data", {}).get("children", [])
            if first_children:
                p_data = first_children[0].get("data", {})
                post_info = {
                    "id": p_data.get("id"),
                    "title": p_data.get("title"),
                    "username": p_data.get("author"),
                    "subreddit": p_data.get("subreddit"),
                    "upvotes": p_data.get("ups", p_data.get("score", 0)),
                    "upvote_ratio": p_data.get("upvote_ratio"),
                    "total_comments": p_data.get("num_comments", 0),
                    "post_text": p_data.get("selftext", ""),
                    "created_utc": p_data.get("created_utc"),
                    "permalink": f"https://www.reddit.com{p_data.get('permalink', '')}",
                    "url": p_data.get("url") or url
                }
        except Exception:
            pass

        # Extract Comments (usually index 1)
        if len(data) >= 2:
            try:
                c_listing = data[1].get("data", {}).get("children", [])
                for item in c_listing:
                    if item.get("kind") == "t1":
                        c = item.get("data", {})
                        author = c.get("author")
                        if author and author != "[deleted]":
                            comments.append({
                                "id": c.get("id"),
                                "username": author,
                                "upvotes": c.get("ups", c.get("score", 0)),
                                "body": c.get("body", ""),
                                "created_utc": c.get("created_utc"),
                                "permalink": f"https://www.reddit.com{c.get('permalink', '')}" if c.get("permalink") else ""
                            })
            except Exception:
                pass

        return {
            "status": "success",
            "source": "rapidapi",
            "post": post_info,
            "comments_count": len(comments),
            "comments": comments
        }

    # Fallback dictionary normalization
    if isinstance(data, dict):
        post_obj = data.get("post") or data.get("submission") or data
        post_info = {
            "title": post_obj.get("title"),
            "username": post_obj.get("author") or post_obj.get("username"),
            "upvotes": post_obj.get("score") or post_obj.get("ups") or post_obj.get("upvotes") or 0,
            "upvote_ratio": post_obj.get("upvote_ratio"),
            "total_comments": post_obj.get("num_comments") or post_obj.get("total_comments") or 0,
            "subreddit": post_obj.get("subreddit")
        }
        raw_comments = data.get("comments") or []
        for c in raw_comments:
            if isinstance(c, dict):
                author = c.get("author") or c.get("username")
                if author and author != "[deleted]":
                    comments.append({
                        "id": c.get("id"),
                        "username": author,
                        "upvotes": c.get("score") or c.get("ups") or 0,
                        "body": c.get("body") or ""
                    })

    return {
        "status": "success",
        "source": "rapidapi",
        "post": post_info,
        "comments_count": len(comments),
        "comments": comments
    }


def fetch_reddit_url_details(url: str, rapidapi_host: str = None) -> dict:
    """
    Main entry point to fetch Reddit post details, username, upvotes, and comments.
    """
    url = url.strip()
    if not url:
        return {"status": "error", "message": "No Reddit URL provided."}

    host = rapidapi_host or RAPIDAPI_REDDIT_HOST

    print(f"[Reddit Fetcher] Fetching Reddit post: {url}")
    print(f"[Reddit Fetcher] Using RapidAPI Host: {host}")

    if not RAPIDAPI_KEY:
        return {
            "status": "error",
            "message": "RAPIDAPI_KEY is not set in backend/.env. Please add RAPIDAPI_KEY to your .env file."
        }

    try:
        result = fetch_via_rapidapi(url, api_key=RAPIDAPI_KEY, host=host)
        return result
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "rapidapi_key_configured": bool(RAPIDAPI_KEY),
            "rapidapi_host": host
        }


if __name__ == "__main__":
    import sys

    # Test URL from command line or default
    url_to_test = sys.argv[1] if len(sys.argv) > 1 else "https://www.reddit.com/r/vadodara/comments/1gjwwoq/please_suggest_me_some_good_cbse_and_igcse/"
    custom_host = sys.argv[2] if len(sys.argv) > 2 else None

    print("=" * 70)
    print("REDDIT POST & COMMENTS FETCHER (RAPIDAPI)")
    print(f"URL: {url_to_test}")
    print("=" * 70)

    res = fetch_reddit_url_details(url_to_test, rapidapi_host=custom_host)

    if res.get("status") == "success" and "post" in res:
        post = res["post"]
        print("\n--- POST DETAILS ---")
        print(f"Title:          {post.get('title')}")
        print(f"Author/Username: u/{post.get('username')}")
        print(f"Subreddit:      r/{post.get('subreddit')}")
        print(f"Upvotes:        {post.get('upvotes')}")
        print(f"Total Comments: {post.get('total_comments')}")

        comments = res.get("comments", [])
        print(f"\n--- TOP COMMENTS (Found: {len(comments)}) ---")
        for i, c in enumerate(comments[:10], 1):
            print(f"\n[{i}] u/{c.get('username')} ({c.get('upvotes')} upvotes):")
            body_preview = c.get('body', '').strip().replace('\n', ' ')
            if len(body_preview) > 180:
                body_preview = body_preview[:180] + "..."
            print(f"    \"{body_preview}\"")

        print("\n" + "=" * 70)
        print("SUMMARY JSON:")
        print(json.dumps({
            "post": post,
            "comments_sample": comments[:3]
        }, indent=2))
    else:
        print("\nResult:")
        print(json.dumps(res, indent=2))
