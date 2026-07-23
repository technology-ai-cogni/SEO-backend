"""
BaseAgent — shared logic every search agent inherits.

Subclasses must implement:
  - search_keyword(keyword: str) -> dict
      Returns: {results, ai_answer, has_grounding, status}
      results is a list of {"url": str, "title": str}

  - generate_seo_summary(keyword: str, results: list) -> str
      Returns: multi-section client-specific SEO analysis

Shared (inherited):
  - calculate_confidence_score()
  - format_results_cell()
  - format_competitors_cell()
  - run_keyword()   ← the top-level method called by the orchestrator
"""

from abc import ABC, abstractmethod
from pathlib import Path
from urllib.parse import urlparse

# ── shared paths & constants ──────────────────────────────────────────────────
BACKEND_DIR  = Path(__file__).resolve().parent.parent.parent
DATASETS_DIR = BACKEND_DIR / "datasets"
CLIENT_DOMAIN = "socialoffline.in"

_AUTHORITY_DOMAINS = {
    "zomato.com", "tripadvisor.com", "tripadvisor.in", "swiggy.com",
    "dineout.co.in", "eazydiner.com", "magicpin.in", "justdial.com",
    "yelp.com", "google.com", "timeout.com", "lbb.in",
    "wikipedia.org", "ndtv.com", "hindustantimes.com", "makemytrip.com",
}


class BaseAgent(ABC):
    """Abstract base class for all AI search agents."""

    # Subclasses must define these
    name: str = "base"
    csv_filename: str = ""          # CSV file in DATASETS_DIR this agent writes to

    # ── abstract interface ────────────────────────────────────────────────────

    @abstractmethod
    def search_keyword(self, keyword: str) -> dict:
        """
        Fetch search results for keyword via the agent's AI/API.
        Returns:
          {
            "results":       list[{"url": str, "title": str}],  # up to 10
            "ai_answer":     str,    # raw full answer text
            "has_grounding": bool,   # structured citations vs regex fallback
            "status":        str,    # "ok" or error string
          }
        """

    @abstractmethod
    def generate_seo_summary(self, keyword: str, results: list) -> str:
        """
        Generate a 4-section client-specific SEO analysis for this keyword
        comparing CLIENT_DOMAIN against the found competitors.
        """

    # ── shared helpers ────────────────────────────────────────────────────────

    def extract_domain(self, url: str, title: str = "") -> str:
        """
        Extract bare domain from URL. If title looks like a bare domain
        (e.g. "swiggy.com"), prefer that — Gemini grounding chunks return
        the domain as the title, which is more reliable than parsing vertex
        redirect URLs.
        """
        if title and "." in title and " " not in title.strip():
            t = title.strip().lower()
            return t[4:] if t.startswith("www.") else t
        try:
            h = urlparse(url).hostname or ""
            return h[4:] if h.startswith("www.") else h
        except Exception:
            return url

    def calculate_confidence_score(
        self, total_found: int, has_grounding: bool, results: list
    ) -> int:
        """
        0–100 composite score:
          Completeness   (0–50): how many of 10 URLs found
          Source quality (0–30): native structured citations vs regex fallback
          Authority hits (0–20): known high-DA domains in results
        """
        if total_found == 0:
            return 0
        completeness   = (min(total_found, 10) / 10) * 50
        source_quality = 30 if has_grounding else 15
        domains        = {self.extract_domain(r.get("url",""), r.get("title","")) for r in results}
        authority_hits = len(domains & _AUTHORITY_DOMAINS)
        authority      = min(authority_hits * 7, 20)
        return min(int(completeness + source_quality + authority), 100)

    def format_results_cell(self, results: list) -> str:
        """Format as '1. Title | URL || 2. Title | URL || ...'"""
        parts = []
        for i, r in enumerate(results, 1):
            title = r.get("title", "").strip() or "(no title)"
            url   = r.get("url",   "").strip()
            parts.append(f"{i}. {title} | {url}")
        return " || ".join(parts)

    def format_competitors_cell(self, results: list) -> str:
        """Comma-separated unique competitor domains."""
        seen, domains = set(), []
        for r in results:
            d = self.extract_domain(r.get("url",""), r.get("title",""))
            if d and "vertexaisearch" not in d and d not in seen:
                seen.add(d)
                domains.append(d)
        return ", ".join(domains)

    def _build_seo_prompt(self, keyword: str, results: list, client_domain: str = CLIENT_DOMAIN):
        """
        Build the (system_prompt, user_prompt) pair for the SEO summary.
        Shared by both agents — only the LLM call differs.
        """
        client_position = None
        client_url      = ""
        for i, r in enumerate(results):
            if client_domain in self.extract_domain(r.get("url",""), r.get("title","")):
                client_position = i + 1
                client_url      = r["url"]
                break

        client_status = (
            f"{client_domain} IS visible at position #{client_position}. URL: {client_url}"
            if client_position else
            f"{client_domain} is NOT currently visible in the top results for this keyword."
        )

        results_block = "\n".join(
            f"  #{i+1}: {r.get('title','(no title)') or '(no title)'} "
            f"| Domain: {self.extract_domain(r['url'], r.get('title',''))} | URL: {r['url']}"
            for i, r in enumerate(results)
        )

        system_prompt = (
            "You are a fast, sharp SEO agent analyzing a keyword's top results against a client domain. "
            "Keep the summary extremely concise and impactful. Use bullet points where possible. "
            "Output EXACTLY these 3 short sections:\n\n"
            "STANDING: (1 brief sentence on client rank)\n\n"
            "COMPETITORS: (1-2 short sentences on who ranks and why)\n\n"
            "ACTION PLAN: (Max 3 brief bullet points of what to do)"
        )
        user_prompt = (
            f"Client website: {client_domain}\n"
            f"Target keyword: \"{keyword}\"\n"
            f"Client current status: {client_status}\n\n"
            f"Current top-ranking competitors:\n{results_block}"
        )
        return system_prompt, user_prompt

    # ── main pipeline ─────────────────────────────────────────────────────────

    def run_keyword(self, keyword: str, client_domain: str = CLIENT_DOMAIN) -> dict:
        """
        Full pipeline for one keyword. Called by the orchestrator.
        Returns a dict with all CSV output columns.
        """
        data          = self.search_keyword(keyword)
        results       = data["results"]
        total_found   = len(results)
        has_grounding = data.get("has_grounding", False)
        status        = data["status"]

        confidence  = self.calculate_confidence_score(total_found, has_grounding, results)
        seo_summary = data.get("seo_summary") or (
            self.generate_seo_summary(keyword, results, client_domain=client_domain) if status == "ok" and hasattr(self, 'generate_seo_summary') else ""
        )

        return {
            "top_10_results":   self.format_results_cell(results),
            "results":          results,
            "competitors":      self.format_competitors_cell(results),
            "total_found":      total_found,
            "confidence_score": confidence,
            "ai_answer":        data["ai_answer"],
            "seo_summary":      seo_summary,
            "status":           status,
        }
