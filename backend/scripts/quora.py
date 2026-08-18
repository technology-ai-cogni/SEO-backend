import os
import csv
import json
import asyncio
from dotenv import load_dotenv
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from openai import AsyncOpenAI

load_dotenv()

# Initialize OpenAI client
openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def normalize_quora_url(url):
    """Normalize Quora URLs by stripping unanswered/ and getting the path."""
    if not url or not isinstance(url, str):
        return None
    try:
        parsed = urlparse(url)
        if "quora.com" not in parsed.netloc:
            return None
        path = parsed.path.strip('/')
        if path.startswith('unanswered/'):
            path = path.replace('unanswered/', '', 1)
        return path
    except Exception:
        return None

async def analyze_gap(topic, top_answer, our_answer):
    """Use OpenAI to compare the top answer with our answer."""
    prompt = f"""You are an SEO and Quora marketing expert.
We are analyzing why our answer on a Quora question is ranked lower than the top answer.

Topic/Question: {topic}

=== TOP ANSWER (Rank 1) ===
Upvotes: {top_answer.get('upvotes', '0')}
Text (truncated):
{top_answer.get('text', '')[:1500]}

=== OUR ANSWER ===
Upvotes: {our_answer.get('upvotes', '0')}
Text (truncated):
{our_answer.get('text', '')[:1500]}

Analyze the difference. Why is our answer ranked lower? Is it primarily because of the upvote count, or is there a noticeable quality/formatting/detail gap? Be concise and actionable (max 4 sentences)."""

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

class QuoraScraper:
    async def start(self, use_bright_data=True):
        self.playwright = await async_playwright().start()

        wss_url = os.getenv("BRIGHTDATA_WSS_URL")
        
        if use_bright_data and wss_url:
            print("Connecting to Bright Data Scraping Browser...")
            self.browser = await self.playwright.chromium.connect_over_cdp(wss_url)
        else:
            print("Launching local browser (No Bright Data URL found)...")
            self.browser = await self.playwright.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"]
            )

        self.context = await self.browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )
        self.page = await self.context.new_page()

    async def fetch_quora_post(self, url: str) -> dict:
        result = {"url": url, "scraped_answers": [], "error": None}
        
        try:
            print(f"\nNavigating to {url}...")
            await self.page.goto(url, timeout=60000, wait_until="domcontentloaded")
            
            print("Scrolling to load answers...")
            for i in range(5):
                await self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await self.page.wait_for_timeout(2000)

            topic_path = normalize_quora_url(url)
            if not topic_path:
                result["error"] = "Invalid topic URL"
                return result

            # JS Evaluation to extract all answers, their text, and upvotes
            extract_script = """(expectedPrefix) => {
                const results = [];
                const seenPaths = new Set();
                const links = document.querySelectorAll('a[href*="/answer/"]');
                
                for (let link of links) {
                    let href = link.getAttribute('href');
                    if (!href) continue;
                    
                    let urlObj;
                    try {
                        urlObj = new URL(href, window.location.origin);
                    } catch(e) { continue; }
                    
                    let path = urlObj.pathname.replace(/^\\//, '');
                    
                    // Must belong to this specific question
                    if (!path.startsWith(expectedPrefix)) continue;
                    
                    if (seenPaths.has(path)) continue;
                    seenPaths.add(path);
                    
                    // Find container: walk up until we hit a container that has an upvote button
                    let container = link;
                    let upvotes = "0";
                    for (let i = 0; i < 15; i++) {
                        if (!container || container === document.body) break;
                        
                        let upvoteBtn = Array.from(container.querySelectorAll('button')).find(b => 
                            (b.innerText && b.innerText.includes('Upvote')) || 
                            (b.getAttribute('aria-label') && b.getAttribute('aria-label').includes('Upvote')) ||
                            (b.innerText && b.innerText.includes('upvote'))
                        );
                        
                        if (upvoteBtn) {
                            let txt = upvoteBtn.innerText || "";
                            let match = txt.match(/([\\d\\.]+[KMBkmb]?)/);
                            if (match) upvotes = match[1];
                            break; 
                        }
                        container = container.parentElement;
                    }
                    
                    // Extract external links inside answer text body
                    let externalLinks = [];
                    let authorUrl = "";
                    if (container) {
                        let innerLinks = container.querySelectorAll('a[href]');
                        for (let a of innerLinks) {
                            let aHref = a.getAttribute('href');
                            if (!aHref) continue;
                            if (aHref.includes('quora.com') && (aHref.includes('/profile/') || aHref.includes('/answer/'))) {
                                if (!authorUrl && aHref.includes('/profile/')) authorUrl = aHref;
                            } else if (!aHref.startsWith('#') && !aHref.startsWith('javascript:') && !aHref.includes('quora.com')) {
                                externalLinks.push(aHref);
                            }
                        }
                    }

                    let text = container ? container.innerText : "";
                    if (text.length > 3000) {
                        text = text.substring(0, 3000); 
                    }
                    
                    results.push({
                        url: path,
                        full_url: link.href || ("https://www.quora.com/" + path),
                        author_url: authorUrl,
                        upvotes: upvotes,
                        text: text,
                        external_links: externalLinks
                    });
                }
                return results;
            }"""

            
            # expectedPrefix e.g. "What-is-SEO/answer/"
            expected_prefix = f"{topic_path}/answer/"
            
            scraped_answers = await self.page.evaluate(extract_script, expected_prefix)
            result["scraped_answers"] = scraped_answers
            print(f"Found {len(scraped_answers)} unique answers on page.")
            
        except Exception as e:
            print(f"Error fetching {url}: {str(e)}")
            result["error"] = str(e)
            
        return result

    async def close(self):
        try:
            await self.context.close()
            await self.browser.close()
            await self.playwright.stop()
        except Exception as e:
            print(f"Error during cleanup: {str(e)}")

async def main():
    import argparse
    parser = argparse.ArgumentParser(description="Quora Topic and Live Link Scraper")
    parser.add_argument("--csv", default="/Users/anandkumaryadav/SEO-backend/offpage_scheduler_template (5).csv", help="Path to input CSV file")
    parser.add_argument("--out", default="quora_test_5_results.json", help="Path to output JSON file")
    parser.add_argument("--no-bright-data", action="store_true", help="Disable Bright Data CDP connection and use local browser")
    parser.add_argument("--limit", type=int, default=5, help="Limit number of rows to process")
    
    args = parser.parse_args()
    input_csv = args.csv
    output_json = args.out
    use_bright_data = not args.no_bright_data
    limit = args.limit
    
    results = []
    print(f"Reading {input_csv} (Processing up to {limit} dataset rows)...")
    
    try:
        scraper = QuoraScraper()
        await scraper.start(use_bright_data=use_bright_data)
        
        with open(input_csv, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            processed_count = 0
            for idx, row in enumerate(reader):
                if limit and processed_count >= limit:
                    break
                activity = row.get('Activity Name', '').strip()
                topic = row.get('Topic', '').strip()
                live = row.get('Live Link', '').strip()
                
                # Process if it's a Quora URL in Topic or Activity
                if not ('quora' in activity.lower() or 'quora.com' in topic.lower()):
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
                    "Top Answer Upvotes": None,
                    "LLM Analysis": None,
                    "Error": None,
                    "All Scraped Answers": []
                }
                
                topic_path = normalize_quora_url(topic)
                live_path = normalize_quora_url(live) if live else None
                
                if not topic_path:
                    row_result["Error"] = "Invalid or empty Topic URL"
                else:
                    print(f"\n[{idx+1}] Processing Topic: {topic}")
                    scrape_data = await scraper.fetch_quora_post(topic)
                    
                    if scrape_data.get("error"):
                        row_result["Error"] = scrape_data["error"]
                    else:
                        scraped = scrape_data.get("scraped_answers", [])
                        row_result["All Scraped Answers"] = scraped
                        
                        if live_path:
                            # Find our mapped answer in the list
                            our_answer = None
                            our_rank = None
                            for i, ans in enumerate(scraped):
                                if ans["url"] == live_path:
                                    our_answer = ans
                                    our_rank = i + 1
                                    break
                                    
                            if our_answer:
                                row_result["Is Present"] = True
                                row_result["Rank"] = our_rank
                                row_result["Our Upvotes"] = our_answer.get("upvotes")
                                print(f"-> SUCCESS: Live link found at Rank {our_rank} (Upvotes: {our_answer.get('upvotes')})!")
                                
                                # If we are not Rank 1, run LLM analysis against Top Answer
                                if our_rank > 1 and len(scraped) > 0:
                                    top_answer = scraped[0]
                                    row_result["Top Answer Upvotes"] = top_answer.get("upvotes")
                                    
                                    print("-> Running OpenAI analysis against Top Answer...")
                                    analysis = await analyze_gap(topic, top_answer, our_answer)
                                    row_result["LLM Analysis"] = analysis
                                    print("-> LLM Analysis completed.")
                                elif our_rank == 1:
                                    row_result["LLM Analysis"] = "We are already ranked #1!"
                            else:
                                row_result["Is Present"] = False
                                print("-> Live link not matched in scraped answers list.")
                        else:
                            print(f"-> Scraped {len(scraped)} answers for Topic (No Live Link provided).")
                
                results.append(row_result)
                
                # Write continuously to output JSON file
                with open(output_json, 'w', encoding='utf-8') as out_f:
                    json.dump(results, out_f, indent=4)
                    
                await scraper.page.wait_for_timeout(2000)
                
    except FileNotFoundError:
        print(f"Error: Could not find the file {input_csv}")
    except Exception as e:
        print(f"An error occurred: {str(e)}")
    finally:
        try:
            await scraper.close()
        except:
            pass
            
    print(f"\nDone! Scraping complete. Saved to {output_json}")

if __name__ == "__main__":
    asyncio.run(main())