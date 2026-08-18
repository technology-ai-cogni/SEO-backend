
import json
import re
import sys
import time
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
from dotenv import load_dotenv

load_dotenv()

def extract_post_id(url: str) -> tuple[str, str]:
    match = re.search(r'/r/([^/]+)/comments/([a-z0-9]+)', url, re.IGNORECASE)
    if match:
        return match.group(1), match.group(2)
    match_generic = re.search(r'/comments/([a-z0-9]+)', url, re.IGNORECASE)
    if match_generic:
        return "reddit", match_generic.group(1)
    raise ValueError(f"Could not extract post ID from URL: {url}")

def expand_and_scroll_all_comments(page):
    """
    Continually scrolls down and clicks 'View replies', 'More comments', 
    and collapsed thread triggers until all comments are fully rendered into the DOM.
    """
    previous_count = 0
    stagnant_cycles = 0
    max_cycles = 25
    
    for cycle in range(max_cycles):
        page.evaluate("""
            if (document && document.body) {
                window.scrollTo(0, document.body.scrollHeight);
            }
        """)
        time.sleep(1.0)
        
        try:
            buttons = page.query_selector_all(
                'button:has-text("reply"), button:has-text("replies"), button:has-text("more"), faceplate-partial[src*="comments"]'
            )
            for btn in buttons[:5]:
                try:
                    if btn.is_visible():
                        btn.click(timeout=600)
                        time.sleep(0.2)
                except Exception:
                    pass
        except Exception:
            pass
            
        current_count = page.locator("shreddit-comment").count()
        if current_count == previous_count:
            stagnant_cycles += 1
            if stagnant_cycles >= 3:
                break
        else:
            stagnant_cycles = 0
            previous_count = current_count

def scrape_reddit_with_playwright(url: str, page) -> dict:
    # Abort static image and video loading to speed up performance
    page.route("*/.{png,jpg,jpeg,gif,webp,svg,mp4,woff,woff2,ttf,otf}", lambda route: route.abort())
    
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    
    try:
        page.wait_for_selector("shreddit-post", timeout=10000)
    except Exception:
        pass
        
    expand_and_scroll_all_comments(page)
    
    html_content = page.content()
    soup = BeautifulSoup(html_content, "html.parser")
    
    post_elem = soup.find("shreddit-post")
    post_content_text = ""
    if post_elem:
        text_div = post_elem.find("div", slot="text-body")
        if text_div:
            post_content_text = text_div.get_text(separator="\n", strip=True)
            
    if post_elem:
        post_info = {
            "post_id": post_elem.get("id"),
            "post_title": post_elem.get("post-title"),
            "post_author": post_elem.get("author"),
            "post_upvotes": int(post_elem.get("score", 0)) if post_elem.get("score") else 0,
            "total_comment_count": int(post_elem.get("comment-count", 0)) if post_elem.get("comment-count") else 0,
            "post_content": post_content_text if post_content_text else "(No body text / Media Post)",
            "subreddit": post_elem.get("subreddit-prefixed-name"),
            "permalink": f"https://www.reddit.com{post_elem.get('permalink')}" if post_elem.get('permalink') else url
        }
    else:
        post_info = {
            "post_title": soup.title.string if soup.title else "Unknown Title",
            "post_upvotes": 0,
            "total_comment_count": 0,
            "post_content": "",
            "permalink": url
        }
        
    extracted_comments = []
    comment_elems = soup.find_all("shreddit-comment")
    
    for c in comment_elems:
        thing_id = c.get("thingid", "").replace("t1_", "")
        author = c.get("author", "[deleted]")
        score = int(c.get("score", 0)) if c.get("score") else 0
        depth = int(c.get("depth", 0)) if c.get("depth") else 0
        
        body_div = c.find("div", slot="comment")
        if body_div:
            body_text = body_div.get_text(separator="\n", strip=True)
        else:
            body_text = c.get_text(strip=True)
            
        extracted_comments.append({
            "comment_id": thing_id,
            "comment_author": author,
            "comment_upvotes": score,
            "comment_body": body_text,
            "depth": depth
        })
        
    top_level_count = sum(1 for c in extracted_comments if c["depth"] == 0)
    
    extracted_comments = sorted(extracted_comments, key=lambda x: x["comment_upvotes"], reverse=True)[:5]
    
    return {
        "source_url": url,
        "post": post_info,
        "summary": {
            "total_post_comment_count": post_info["total_comment_count"],
            "top_level_comments": top_level_count,
            "total_extracted_comments": len(extracted_comments)
        },
        "comments": extracted_comments
    }

import os

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    input_file = os.path.join(script_dir, "reddit_input.json")
    output_file = os.path.join(script_dir, "reddit_output.json")
    
    try:
        with open(input_file, "r", encoding="utf-8") as f:
            urls = json.load(f)
    except FileNotFoundError:
        print(f"Error: Could not find '{input_file}'.")
        sys.exit(1)
        
    print(f"Launching Playwright Headless Scraper ({len(urls)} URLs)...\n")
    all_results = []
    
    with sync_playwright() as p:
        wss_url = os.getenv("BRIGHTDATA_WSS_URL")
        if wss_url:
            print("Connecting to Bright Data Scraping Browser...")
            browser = p.chromium.connect_over_cdp(wss_url)
        else:
            print("Launching local browser (No Bright Data URL found)...")
            browser = p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-blink-features=AutomationControlled"
                ]
            )
        
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 900}
        )
        
        context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            window.navigator.chrome = { runtime: {} };
        """)
        
        page = context.new_page()
        
        for i, url in enumerate(urls, 1):
            print(f"[{i}/{len(urls)}] Scraping: {url}")
            try:
                result = scrape_reddit_with_playwright(url, page)
                all_results.append(result)
                post = result["post"]
                summary = result["summary"]
                print(f"  ✓ Finished! {post.get('subreddit', 'Reddit')}")
                print(f"    • Title: '{post['post_title'][:40]}...'")
                print(f"    • Post Upvotes: {post['post_upvotes']} | Target Post Comment Count: {post['total_comment_count']}")
                print(f"    • Total Comments Extracted into JSON: {summary['total_extracted_comments']}")
            except Exception as e:
                print(f"  ✗ Failed for {url}: {e}")
                
            time.sleep(1.5)
            
        browser.close()
        
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)
        
    print("\n" + "="*60)
    print(f"COMPLETE! Exported 100% of posts, upvotes & comments to '{output_file}'.")
    print("="*60)

if __name__ == "__main__":
    main()