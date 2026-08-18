import os
import csv
import json
import time
import asyncio
from dotenv import load_dotenv
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from openai import AsyncOpenAI

try:
    import undetected_chromedriver as uc
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    HAS_UC = True
except ImportError:
    HAS_UC = False

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

class UndetectedQuoraScraper:
    def __init__(self):
        self.driver = None

    async def start(self, use_bright_data=False, headless=False):
        print(f"\n[Undetected Chromedriver] Launching undetected Chrome browser (headless={headless})...")
        
        def make_options():
            opts = uc.ChromeOptions()
            if headless:
                opts.add_argument('--headless=new')
            opts.add_argument('--no-sandbox')
            opts.add_argument('--disable-dev-shm-usage')
            opts.add_argument('--window-size=1366,768')
            opts.add_argument('--disable-blink-features=AutomationControlled')
            return opts
        
        try:
            self.driver = uc.Chrome(options=make_options())
        except Exception:
            try:
                self.driver = uc.Chrome(options=make_options(), version_main=150)
            except Exception:
                self.driver = uc.Chrome(options=make_options(), use_subprocess=True)

    async def login_quora(self, email: str = None, password: str = None):
        email = email or os.getenv("QUORA_EMAIL")
        password = password or os.getenv("QUORA_PASSWORD")
        cookie_file = "quora_cookies.json"

        # 1. Try loading saved cookies first
        if os.path.exists(cookie_file):
            try:
                print(f"\n[Cookies] Loading saved session cookies from {cookie_file}...")
                self.driver.get("https://www.quora.com/")
                time.sleep(2)
                with open(cookie_file, "r", encoding="utf-8") as f:
                    cookies = json.load(f)
                    for cookie in cookies:
                        if 'sameSite' in cookie and cookie['sameSite'] not in ["Strict", "Lax", "None"]:
                            del cookie['sameSite']
                        try:
                            self.driver.add_cookie(cookie)
                        except Exception:
                            pass
                self.driver.get("https://www.quora.com/")
                time.sleep(3)
                print("[Cookies] Cookies loaded successfully! Active session restored.")
                return
            except Exception as e:
                print(f"[Cookies] Failed to load cookies ({str(e)}). Proceeding with normal login...")

        if not email or not password:
            print("[WARN] No Quora credentials found (QUORA_EMAIL / QUORA_PASSWORD or --email/--password). Proceeding without login...")
            return

        try:
            print(f"\n[Step 1 - Undetected Chrome] Navigating to https://www.quora.com to log in as {email}...")
            self.driver.get("https://www.quora.com/")
            time.sleep(3)

            # Check if "Login" link/button is present to toggle signup modal to login modal
            try:
                login_tabs = self.driver.find_elements(By.XPATH, "//div[contains(text(), 'Login')] | //span[contains(text(), 'Login')] | //a[contains(text(), 'Login')] | //button[contains(., 'Login')] | //*[contains(@class, 'q-click-wrapper') and .//*[contains(text(), 'Login')]]")
                for tab in login_tabs:
                    try:
                        if tab.is_displayed():
                            print(f"Clicking 'Login' link ('{tab.text.strip()}') to expose email & password input fields...")
                            self.driver.execute_script("arguments[0].click();", tab)
                            time.sleep(2)
                            break
                    except Exception:
                        pass
            except Exception:
                pass

            print("Waiting for login input fields (email & password)...")
            email_field = None
            try:
                email_field = WebDriverWait(self.driver, 10).until(
                    EC.visibility_of_element_located((By.XPATH, "//input[@id='email' or @name='email' or contains(@placeholder, 'email') or contains(@placeholder, 'Email')]"))
                )
            except Exception:
                email_field = None

            if email_field:
                print(f"[OK] Filling Email field: {email}")
                email_field.click()
                email_field.clear()
                email_field.send_keys(email)
                time.sleep(0.5)

            pass_field = None
            try:
                pass_field = WebDriverWait(self.driver, 5).until(
                    EC.visibility_of_element_located((By.XPATH, "//input[@id='password' or @name='password' or contains(@placeholder, 'password') or contains(@placeholder, 'Password')]"))
                )
            except Exception:
                pass_field = None

            if pass_field:
                print("[OK] Filling Password field...")
                pass_field.click()
                pass_field.clear()
                pass_field.send_keys(password)
                time.sleep(0.5)

            print("\n" + "="*70)
            print("[WAITING] WAITING 50 SECONDS BEFORE CLICKING LOGIN BUTTON...")
            print("="*70 + "\n")
            time.sleep(50)

            # Locate and click Login submit button
            login_btn = None
            try:
                login_btns = self.driver.find_elements(By.XPATH, "//button[contains(., 'Login') or contains(., 'Log In')] | //*[@class='puppeteer_test_button_text' and contains(text(), 'Login')] | //input[@type='submit']")
                for btn in login_btns:
                    if btn.is_displayed():
                        login_btn = btn
                        break
            except Exception:
                login_btn = None

            if login_btn:
                print("[OK] Clicking Login submit button now...")
                try:
                    login_btn.click()
                except Exception:
                    self.driver.execute_script("arguments[0].click();", login_btn)
                time.sleep(6)
            else:
                print("[WARN] Login button not found or already submitted. Moving forward...")

            # Save cookies after successful login
            try:
                cookies = self.driver.get_cookies()
                if cookies:
                    with open(cookie_file, "w", encoding="utf-8") as f:
                        json.dump(cookies, f, indent=4)
                    print(f"[Cookies] Successfully saved {len(cookies)} session cookies to {cookie_file}!")
            except Exception as e:
                print(f"[Cookies] Failed to save cookies: {str(e)}")

        except Exception as e:
            print(f"Warning: Exception during login step: {str(e)}")

    async def fetch_quora_post(self, url: str) -> dict:
        result = {"url": url, "scraped_answers": [], "error": None}
        try:
            print(f"\nNavigating to topic URL: {url}...")
            self.driver.get(url)
            time.sleep(3)

            print("Scrolling to load answers...")
            for i in range(5):
                self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                time.sleep(2)

            # Click collapsed answers buttons
            try:
                collapsed_btns = self.driver.find_elements(By.XPATH, "//*[contains(text(), 'answers collapsed') or contains(text(), 'answer collapsed') or contains(text(), 'collapsed')]")
                for btn in collapsed_btns:
                    try:
                        if btn.is_displayed() and "collapsed" in btn.text.lower():
                            print(f"Clicking collapsed answers button ('{btn.text.strip()}')...")
                            btn.click()
                            time.sleep(2)
                    except Exception:
                        pass
            except Exception:
                pass

            # Click (more) expand buttons
            try:
                more_btns = self.driver.find_elements(By.XPATH, "//*[contains(text(), '(more)')]")
                for btn in more_btns[:15]:
                    try:
                        if btn.is_displayed():
                            btn.click()
                            time.sleep(0.5)
                    except Exception:
                        pass
            except Exception:
                pass

            print("[PAUSE] Pausing 5 seconds for collapsed answers content to render before link extraction...")
            time.sleep(5)

            topic_path = normalize_quora_url(url)
            expected_prefix = f"{topic_path}/answer/" if topic_path else ""

            extract_script = """(expectedPrefix) => {
                const results = [];
                const seenPaths = new Set();
                let links = Array.from(document.querySelectorAll('a[href*="/answer/"], a[href*="/profile/"]'));
                
                for (let link of links) {
                    let href = link.getAttribute('href');
                    if (!href) continue;
                    
                    let urlObj;
                    try {
                        urlObj = new URL(href, window.location.origin);
                    } catch(e) { continue; }
                    
                    let path = urlObj.pathname.replace(/^\\//, '');
                    if (href.includes('/answer/') && expectedPrefix && !path.toLowerCase().includes(expectedPrefix.toLowerCase())) continue;
                    if (seenPaths.has(path)) continue;
                    seenPaths.add(path);
                    
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
                    if (text.length > 3000) text = text.substring(0, 3000);
                    
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

            scraped_answers = self.driver.execute_script(extract_script, expected_prefix)
            result["scraped_answers"] = scraped_answers or []
            print(f"Found {len(result['scraped_answers'])} unique answers on page.")

        except Exception as e:
            print(f"Error fetching {url}: {str(e)}")
            result["error"] = str(e)

        return result

    async def close(self):
        if self.driver:
            try:
                self.driver.quit()
            except Exception:
                pass

class QuoraScraper:
    async def start(self, use_bright_data=True, headless=False):
        self.playwright = await async_playwright().start()

        wss_url = os.getenv("BRIGHTDATA_WSS_URL")
        
        if use_bright_data and wss_url:
            print("Connecting to Bright Data Scraping Browser...")
            self.browser = await self.playwright.chromium.connect_over_cdp(wss_url)
        else:
            print(f"Launching local browser (headless={headless})...")
            self.browser = await self.playwright.chromium.launch(
                headless=False,
                args=[
                    "--no-sandbox", 
                    "--disable-dev-shm-usage",
                    "--disable-blink-features=AutomationControlled",
                    "--disable-infobars"
                ]
            )

        self.context = await self.browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            viewport={"width": 1366, "height": 768},
            locale="en-US"
        )
        await self.context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
        """)
        self.page = await self.context.new_page()

    async def login_quora(self, email: str = None, password: str = None):
        """Navigate to Quora home and wait for input fields before logging in."""
        email = email or os.getenv("QUORA_EMAIL")
        password = password or os.getenv("QUORA_PASSWORD")
        cookie_file = "quora_cookies.json"

        # 1. Try loading saved session cookies first
        if os.path.exists(cookie_file):
            try:
                print(f"\n[Cookies] Loading saved session cookies from {cookie_file}...")
                with open(cookie_file, "r", encoding="utf-8") as f:
                    cookies = json.load(f)
                    await self.context.add_cookies(cookies)
                await self.page.goto("https://www.quora.com/", timeout=60000, wait_until="domcontentloaded")
                await self.page.wait_for_timeout(3000)
                print("[Cookies] Session cookies loaded successfully! Active session restored.")
                return
            except Exception as e:
                print(f"[Cookies] Could not load cookies ({str(e)}). Proceeding with standard login...")

        if not email or not password:
            print("No Quora login credentials found (QUORA_EMAIL / QUORA_PASSWORD or --email/--password). Proceeding without login...")
            return

        try:
            print(f"\n[Step 1] Navigating to https://www.quora.com to log in as {email}...")
            await self.page.goto("https://www.quora.com/", timeout=60000, wait_until="domcontentloaded")

            print("Waiting for login input fields (email & password) to become available...")
            email_selector = 'input#email, input[name="email"], input[placeholder="Your email"], input[type="email"]'
            
            email_input = None
            try:
                email_input = await self.page.wait_for_selector(email_selector, timeout=10000, state="visible")
            except Exception:
                email_input = None

            if not email_input:
                print("Login fields not immediately visible. Checking for 'Login' tab/link...")
                login_tab_selectors = [
                    'div:has-text("Login")',
                    'span:has-text("Login")',
                    'button:has-text("Login")',
                    '.q-click-wrapper:has-text("Login")',
                    'a:has-text("Login")'
                ]
                for sel in login_tab_selectors:
                    try:
                        tab = await self.page.query_selector(sel)
                        if tab and await tab.is_visible():
                            tab_txt = (await tab.inner_text()).strip()
                            if tab_txt.lower() == "login":
                                print(f"Clicking '{tab_txt}' tab on Quora homepage...")
                                await tab.click()
                                await self.page.wait_for_timeout(1500)
                                break
                    except Exception:
                        pass

                try:
                    email_input = await self.page.wait_for_selector(email_selector, timeout=8000, state="visible")
                except Exception:
                    email_input = None

            if not email_input:
                print("[WARN] Login input fields were not available on page. Proceeding to topic URL without login...")
                return

            print(f"[OK] Login input fields available! Filling Email: {email}")
            await email_input.click()
            await email_input.fill("")
            await email_input.fill(email)
            await self.page.wait_for_timeout(500)

            # Wait for password input field to be visible
            pass_selector = 'input#password, input[name="password"], input[placeholder="Your password"], input[type="password"]'
            pass_input = None
            try:
                pass_input = await self.page.wait_for_selector(pass_selector, timeout=5000, state="visible")
            except Exception:
                pass_input = None

            if pass_input:
                print("[OK] Filling Password field...")
                await pass_input.click()
                await pass_input.fill("")
                await pass_input.fill(password)
                await self.page.wait_for_timeout(500)

            # Locate and click Login submit button
            login_btn_selectors = [
                'button:has(.puppeteer_test_button_text:has-text("Login"))',
                'button:has-text("Login")',
                'button:has-text("Log In")',
                '.puppeteer_test_button_text:has-text("Login")',
                'input[type="submit"]'
            ]
            for sel in login_btn_selectors:
                btn = await self.page.query_selector(sel)
                if btn and await btn.is_visible():
                    print(f"\n[OK] Login fields filled! Waiting 50 seconds before clicking Login button ({sel})...")
                    await self.page.wait_for_timeout(50000)
                    print(f"[OK] Clicking Login button ({sel})...")
                    await btn.click()
                    await self.page.wait_for_timeout(6000)
                    print("[OK] Login submitted! Authenticated session active. Moving forward...")
                    
                    try:
                        cookies = await self.context.cookies()
                        if cookies:
                            with open(cookie_file, "w", encoding="utf-8") as f:
                                json.dump(cookies, f, indent=4)
                            print(f"[Cookies] Successfully saved session cookies to {cookie_file}! Future runs will use these cookies.")
                    except Exception as e:
                        print(f"[Cookies] Failed to save cookies: {str(e)}")
                    break

        except Exception as e:
            print(f"Warning: Exception during login step: {str(e)}")

    async def fetch_quora_post(self, url: str) -> dict:
        result = {"url": url, "scraped_answers": [], "error": None}
        
        try:
            print(f"\nNavigating to topic URL: {url}...")
            await self.page.goto(url, timeout=60000, wait_until="domcontentloaded")
            await self.page.wait_for_timeout(3000)
            
            print("Scrolling to load answers...")
            for i in range(5):
                await self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await self.page.wait_for_timeout(2000)

            # 1. Click on collapsed answers elements (e.g. "4 answers collapsed")
            try:
                collapsed_selectors = [
                    'div:has-text("answers collapsed")',
                    'div:has-text("answer collapsed")',
                    'div:has-text("collapsed")',
                    '.q-click-wrapper:has-text("collapsed")',
                    'span:has-text("collapsed")'
                ]
                for sel in collapsed_selectors:
                    collapsed_btns = await self.page.query_selector_all(sel)
                    for btn in collapsed_btns:
                        try:
                            btn_text = await btn.inner_text()
                            if "collapsed" in btn_text.lower():
                                print(f"Found collapsed answers button ('{btn_text.strip()}'), clicking to reveal...")
                                await btn.click(timeout=2000)
                                await self.page.wait_for_timeout(2000)
                        except Exception:
                            pass
            except Exception as e:
                print(f"Notice: Collapsed answers click step: {str(e)}")

            # 2. Click any '(more)' expand buttons to reveal full answer text and links
            try:
                more_btns = await self.page.query_selector_all('div:has-text("(more)"), span:has-text("(more)")')
                for btn in more_btns[:15]:
                    try:
                        await btn.click(timeout=1000)
                    except Exception:
                        pass
            except Exception:
                pass

            print("[PAUSE] Pausing 5 seconds for collapsed answers content to render before link extraction...")
            await self.page.wait_for_timeout(5000)

            topic_path = normalize_quora_url(url)
            if not topic_path:
                result["error"] = "Invalid topic URL"
                return result

            # JS Evaluation to extract all answers, their text, and upvotes
            extract_script = """(expectedPrefix) => {
                const results = [];
                const seenPaths = new Set();
                let links = Array.from(document.querySelectorAll('a[href*="/answer/"], a[href*="/profile/"]'));
                
                for (let link of links) {
                    let href = link.getAttribute('href');
                    if (!href) continue;
                    
                    let urlObj;
                    try {
                        urlObj = new URL(href, window.location.origin);
                    } catch(e) { continue; }
                    
                    let path = urlObj.pathname.replace(/^\\//, '');
                    
                    // Must belong to this specific question if answer link
                    if (href.includes('/answer/') && expectedPrefix && !path.toLowerCase().includes(expectedPrefix.toLowerCase())) continue;
                    
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
    parser.add_argument("--csv", default="offpage_scheduler_template (5).csv", help="Path to input CSV file")
    parser.add_argument("--out", default="quora_test_5_results.json", help="Path to output JSON file")
    parser.add_argument("--no-bright-data", action="store_true", help="Disable Bright Data CDP connection and use local browser")
    parser.add_argument("--headful", action="store_true", help="Show local browser window visually")
    parser.add_argument("--uc", action="store_true", help="Use Undetected Chromedriver to bypass bot detection")
    parser.add_argument("--email", default="", help="Quora user email for authentication")
    parser.add_argument("--password", default="", help="Quora user password for authentication")
    parser.add_argument("--limit", type=int, default=50, help="Limit number of rows to process")
    
    args = parser.parse_args()
    input_csv = args.csv
    output_json = args.out
    use_bright_data = not args.no_bright_data
    limit = args.limit
    use_uc = args.uc and HAS_UC
    
    results = []
    print(f"Reading {input_csv} (Processing up to {limit} dataset rows)...")
    
    try:
        scraper = None
        if use_uc:
            print("Using Undetected Chromedriver for stealth automation...")
            try:
                scraper = UndetectedQuoraScraper()
                await scraper.start(use_bright_data=use_bright_data, headless=not args.headful)
            except Exception as e:
                print(f"[WARN] Undetected Chromedriver initialization failed ({str(e)}). Falling back to Playwright stealth engine...")
                scraper = QuoraScraper()
                await scraper.start(use_bright_data=use_bright_data, headless=not args.headful)
        else:
            scraper = QuoraScraper()
            await scraper.start(use_bright_data=use_bright_data, headless=not args.headful)

        await scraper.login_quora(email=args.email, password=args.password)
        
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
                                ans_url = ans.get("url", "")
                                ans_full = ans.get("full_url", "")
                                ans_author = ans.get("author_url", "")
                                
                                is_match = False
                                if live_path and (live_path in ans_url or ans_url in live_path):
                                    is_match = True
                                elif live and (live in ans_full or live in ans_author):
                                    is_match = True
                                elif live_path and ("/" in live_path):
                                    author_segment = live_path.split("/")[-1]
                                    if author_segment and (author_segment in ans_url or author_segment in ans_author or author_segment in ans_full):
                                        is_match = True
                                
                                if is_match:
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
                    
                if hasattr(scraper, 'page') and scraper.page:
                    await scraper.page.wait_for_timeout(2000)
                else:
                    time.sleep(2)
                
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