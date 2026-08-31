"""
SerpAPIAgent - Fetches raw organic search results from SerpAPI.
Used for the AI Overview tab to provide live SERP data without LLM analysis.
"""

import os
import sys
from pathlib import Path
from .base_agent import BaseAgent

# Ensure exp-1 and scripts directories are in sys.path
exp1_dir = Path(__file__).resolve().parent.parent
backend_dir = exp1_dir.parent
scripts_dir = backend_dir / "scripts"
if str(exp1_dir) not in sys.path:
    sys.path.insert(0, str(exp1_dir))
if str(scripts_dir) not in sys.path:
    sys.path.insert(0, str(scripts_dir))

try:
    from agentic_rank_checker import fetch_serp_brightdata
except Exception:
    fetch_serp_brightdata = None

class SerpAPIAgent(BaseAgent):
    name = "serpapi"
    csv_filename = "serpapi_results.csv"

    def search_keyword(self, keyword: str) -> dict:
        try:
            results_dicts = fetch_serp_brightdata(keyword, start=0)
            if not results_dicts:
                return {
                    "results": [],
                    "ai_answer": "No results or Bright Data error.",
                    "has_grounding": False,
                    "status": "API error: No results",
                    "seo_summary": "Error: Bright Data returned no results. Check BRIGHTDATA_API_KEY."
                }
            
            results = results_dicts[:10]
            
            return {
                "results": results,
                "ai_answer": "Raw Bright Data fetched successfully.",
                "has_grounding": True,
                "status": "ok",
                "seo_summary": "BRIGHTDATA RESULTS GATHERED SUCCESSFULLY."
            }
        except RuntimeError as e:
            return {
                "results": [],
                "ai_answer": str(e),
                "has_grounding": False,
                "status": f"API error: {str(e)}",
                "seo_summary": f"Error: {str(e)}"
            }
        except Exception as e:
            return {
                "results": [],
                "ai_answer": f"Bright Data Exception: {str(e)}",
                "has_grounding": False,
                "status": f"API error: {str(e)}",
                "seo_summary": f"Exception occurred while fetching Bright Data: {str(e)}"
            }

    def generate_seo_summary(self, keyword: str, results: list, client_domain: str = None) -> str:
        return "BRIGHTDATA RESULTS GATHERED SUCCESSFULLY."
