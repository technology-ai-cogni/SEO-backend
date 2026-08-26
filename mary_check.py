import asyncio
import os
import json
from playwright.async_api import async_playwright

async def test_mary():
    live_url = "https://www.quora.com/Which-are-the-top-10-international-schools-in-India/answer/Mary-26371?ch=10&oid=1477743899467741&share=91a678cf&srid=5v1Hwl&target_type=answer"
    main_topic_url = live_url.split('?')[0].split('/answer/')[0]
    
    cookie_path = r"d:\AWS-deployed SEO\SEO-backend\backend\quora_cookies.json"
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        if os.path.exists(cookie_path):
            with open(cookie_path, 'r') as f:
                cookies = json.load(f)
                formatted = [{'name': c['name'], 'value': c['value'], 'domain': c.get('domain', '.quora.com'), 'path': c.get('path', '/')} for c in cookies]
                await context.add_cookies(formatted)

        # STEP 1: Open OUR ANSWER in a NEW TAB / PAGE to extract our upvotes directly
        print(f"[TAB 1] Opening OUR ANSWER live link: {live_url}")
        live_page = await context.new_page()
        await live_page.goto(live_url, wait_until="domcontentloaded", timeout=25000)
        await live_page.wait_for_timeout(3000)

        # Check for Quora deleted banner
        live_deleted = False
        body_text = await live_page.inner_text("body")
        if "Quora deleted this answer" in body_text or "This answer was deleted" in body_text:
            live_deleted = True
            print("[TAB 1] Notice: Quora deleted this answer!")

        our_upvotes = "0"
        if not live_deleted:
            extract_upvote_js = """() => {
                let candidates = Array.from(document.querySelectorAll('.puppeteer_test_button_text, [aria-label*="Upvote"], [aria-label*="upvote"], button, div[role="button"]'));
                let upvoteBtns = candidates.filter(el => {
                    let txt = el.innerText || el.textContent || "";
                    let label = el.getAttribute('aria-label') || "";
                    return /upvote/i.test(txt) || /upvote/i.test(label) || el.classList.contains('puppeteer_test_button_text');
                });
                let topBtns = upvoteBtns.filter(b => !upvoteBtns.some(other => other !== b && other.contains(b)));

                for (let btn of topBtns) {
                    let clone = btn.cloneNode(true);
                    let hiddenSpans = clone.querySelectorAll('.qu-visibility--hidden, .qu-display--none, [style*="opacity: 0"], [style*="opacity:0"], [style*="display: none"], [style*="display:none"]');
                    hiddenSpans.forEach(h => h.remove());
                    let btnTxt = (clone.innerText || clone.textContent || "").replace(/upvote[s]?/gi, '').replace(/[·\\•]/g, '').trim();
                    let match = btnTxt.match(/([\\d\\.]+[KMBkmb]?)/);
                    if (match && match[1]) return match[1];
                }
                return "0";
            }"""
            our_upvotes = await live_page.evaluate(extract_upvote_js)
            print(f"[TAB 1] Extracted Our Upvotes directly from Live Link Tab: '{our_upvotes}'")

        await live_page.close()

        # STEP 2: Open MAIN QUESTION THREAD in a SECOND TAB / PAGE to extract Top 3 answers & Top 3 upvotes
        print(f"\n[TAB 2] Opening MAIN QUESTION THREAD: {main_topic_url}")
        topic_page = await context.new_page()
        await topic_page.goto(main_topic_url, wait_until="domcontentloaded", timeout=25000)
        await topic_page.wait_for_timeout(4000)

        for _ in range(5):
            await topic_page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await topic_page.wait_for_timeout(1000)

        extract_thread_js = """() => {
            const results = [];
            const seenContainers = new Set();
            let upvoteBtns = Array.from(document.querySelectorAll('.puppeteer_test_button_text, button[aria-label*="Upvote"], button[aria-label*="upvote"], div[aria-label*="Upvote"], div[aria-label*="upvote"]'));
            let topBtns = upvoteBtns.filter(b => !upvoteBtns.some(other => other !== b && other.contains(b)));

            for (let btn of topBtns) {
                let clone = btn.cloneNode(true);
                let hiddenSpans = clone.querySelectorAll('.qu-visibility--hidden, .qu-display--none, [style*="opacity: 0"], [style*="opacity:0"], [style*="display: none"], [style*="display:none"]');
                hiddenSpans.forEach(h => h.remove());
                
                let btnTxt = (clone.innerText || clone.textContent || "").replace(/upvote[s]?/gi, '').replace(/[·\\•]/g, '').trim();
                let match = btnTxt.match(/([\\d\\.]+[KMBkmb]?)/);
                let upvotes = (match && match[1]) ? match[1] : "0";
                
                let container = btn;
                for (let i = 0; i < 15; i++) {
                    if (!container || container === document.body) break;
                    let links = container.querySelectorAll('a[href*="/answer/"], a[href*="/profile/"]');
                    if (links && links.length > 0) break;
                    container = container.parentElement;
                }
                if (!container || seenContainers.has(container)) continue;
                seenContainers.add(container);
                
                let profileLink = container.querySelector('a[href*="/profile/"]');
                let answerLink = container.querySelector('a[href*="/answer/"]');
                let targetLink = answerLink || profileLink;
                if (!targetLink) continue;
                
                let href = targetLink.getAttribute('href');
                let path = href.replace(/^https?:\\/\\/[^\\/]+\\//, '').replace(/^\\//, '');
                
                let text = container.innerText || container.textContent || "";
                results.push({
                    upvotes: upvotes,
                    url: path,
                    author: profileLink ? profileLink.innerText.trim() : "",
                    textSnippet: text.substring(0, 150).replace(/\\n/g, ' ')
                });
            }
            return results;
        }"""

        answers = await topic_page.evaluate(extract_thread_js)
        print(f"[TAB 2] Scraped {len(answers)} answer cards on main thread.")
        
        live_slug = "mary-26371"
        found_rank = None
        for idx, a in enumerate(answers, 1):
            is_m = live_slug in a['url'].lower() or live_slug in a['textSnippet'].lower() or live_slug.replace('-', ' ') in a['textSnippet'].lower()
            if is_m:
                found_rank = idx

        # Calculate max top 3 upvotes
        top3 = answers[:3]
        top3_vals = []
        for t in top3:
            v_str = t.get('upvotes', '0')
            try:
                if 'K' in v_str.upper():
                    v_num = int(float(v_str.upper().replace('K', '')) * 1000)
                elif 'M' in v_str.upper():
                    v_num = int(float(v_str.upper().replace('M', '')) * 1000000)
                else:
                    v_num = int(float(v_str))
            except:
                v_num = 0
            top3_vals.append(v_num)

        max_top3 = max(top3_vals) if top3_vals else 0

        print(f"\n==========================================")
        print(f"OUR UPVOTES (From Live Link Tab): '{our_upvotes}'")
        print(f"OUR RANK ON THREAD: {found_rank or 'Not Found / Below Ranks'}")
        print(f"TOP 3 MAX UPVOTES (From Question Thread Tab): {max_top3}")
        print(f"==========================================\n")

        await topic_page.close()
        await browser.close()

if __name__ == "__main__":
    asyncio.run(test_mary())
