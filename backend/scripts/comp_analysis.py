"""
Aggregates SERP rank_meta (top_links per keyword) into a competitor
intelligence report -- either as a standalone CLI over a CSV export, or
called in-process by the backend (see find_competitors_for_rows()) against
rows pulled straight from keyword_categories via db.get_domain_results().

Both paths share the same parsing/aggregation/scoring logic below --
only how the rows are obtained differs (pd.read_csv vs. a DB query).
"""
import os
import sys
import json
import argparse
from collections import defaultdict
from urllib.parse import urlparse
from typing import Dict, List, Optional
from dotenv import load_dotenv
import pandas as pd
load_dotenv()
try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

# Domains that are directories / social / video platforms rather than real
# competing landing pages. Excluded from the competitor list by default.
DEFAULT_EXCLUDE_DOMAINS = {
    "justdial.com", "quora.com", "youtube.com", "instagram.com",
    "facebook.com", "scribd.com", "dailymotion.com", "twitter.com", "x.com",
    "linkedin.com", "pinterest.com", "reddit.com", "wikipedia.org",
}

# Same env var convention as services/category_checker.py and
# scripts/landing_blog_classifier.py.
OPENAI_MODEL_DEFAULT = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini")


def get_domain(url: str) -> str:
    if not url or not isinstance(url, str):
        return ""
    u = url.strip()
    if not u.startswith("http"):
        u = "https://" + u
    try:
        netloc = urlparse(u).netloc.lower()
        return netloc[4:] if netloc.startswith("www.") else netloc
    except Exception:
        return ""


def parse_rank_meta_rows(rows: List[dict]) -> pd.DataFrame:
    """Turn raw keyword_categories rows (dicts with at least keyword,
    rank_meta, rank_checked_at) into a DataFrame with top_links/
    checked_domain parsed out of rank_meta, deduped to the latest rank
    check per keyword. Shared by load_rows() (CSV path) and
    find_competitors_for_rows() (in-process DB path) -- rank_meta may
    arrive as either a JSON string (CSV) or an already-parsed dict (DB)."""
    df = pd.DataFrame(rows)
    if df.empty:
        return df

    def parse_meta(raw):
        if raw is None or (isinstance(raw, float)):
            return [], ""
        try:
            d = raw if isinstance(raw, dict) else json.loads(raw)
            return d.get("top_links", []), d.get("checked_domain", "")
        except Exception:
            return [], ""

    parsed = df["rank_meta"].apply(parse_meta)
    df["top_links"] = parsed.apply(lambda t: t[0])
    df["checked_domain"] = parsed.apply(lambda t: t[1])

    df["rank_checked_at"] = pd.to_datetime(df["rank_checked_at"], errors="coerce", utc=True)
    dedupe_cols = [c for c in ["project_name", "keyword"] if c in df.columns]
    df = df.sort_values("rank_checked_at").drop_duplicates(subset=dedupe_cols, keep="last")
    return df.reset_index(drop=True)


def load_rows(csv_path: str) -> pd.DataFrame:
    """Load the CSV and parse rank_meta JSON into usable columns."""
    df = pd.read_csv(csv_path)

    required = {"project_name", "keyword", "rank_meta", "rank_checked_at", "rank"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Input CSV is missing required columns: {missing}")

    return parse_rank_meta_rows(df.to_dict("records"))


def aggregate_competitors(
    project_rows: pd.DataFrame,
    exclude_domains: set,
) -> Dict[str, dict]:
    """
    For a single project's rows, build per-competitor-domain stats:
    {domain: {"keywords": {keyword: best_position}, ...}}
    """
    own_domain = ""
    if len(project_rows) and project_rows["checked_domain"].iloc[0]:
        own_domain = get_domain(str(project_rows["checked_domain"].iloc[0]))

    stats: Dict[str, dict] = defaultdict(lambda: {"keywords": {}})

    for _, row in project_rows.iterrows():
        keyword = row["keyword"]
        top_links = row["top_links"] or []
        seen_this_keyword = set()
        for idx, url in enumerate(top_links, start=1):
            dom = get_domain(url)
            if not dom or dom == own_domain or dom in exclude_domains:
                continue
            if dom in seen_this_keyword:
                continue  # only keep best (first) position per domain per keyword
            seen_this_keyword.add(dom)
            best = stats[dom]["keywords"].get(keyword)
            if best is None or idx < best:
                stats[dom]["keywords"][keyword] = idx

    return stats, own_domain


def serp_comp_level(coverage: float, avg_rank: float, max_pos: int = 40) -> (str, float):
    """Rule-based competitor strength score from keyword coverage + average rank position."""
    position_score = max(0.0, (max_pos + 1 - avg_rank) / max_pos)
    score = round(0.6 * coverage + 0.4 * position_score, 3)
    if score >= 0.55:
        level = "High"
    elif score >= 0.3:
        level = "Medium"
    else:
        level = "Low"
    return level, score


def build_competitor_table(stats: dict, total_keywords: int, top_n: Optional[int] = None) -> List[dict]:
    rows = []
    for domain, data in stats.items():
        kw_positions = data["keywords"]
        ranking_keywords = len(kw_positions)
        avg_rank = round(sum(kw_positions.values()) / ranking_keywords, 2) if ranking_keywords else 0
        coverage = ranking_keywords / total_keywords if total_keywords else 0
        level, score = serp_comp_level(coverage, avg_rank if avg_rank else 999)
        rows.append({
            "competitor_domain": domain,
            "total_keywords": total_keywords,
            "ranking_keywords": ranking_keywords,
            "coverage_pct": round(coverage * 100, 1),
            "avg_rank": avg_rank,
            "serp_comp_level": level,
            "serp_comp_score": score,
            "keyword_positions": kw_positions,  # kept for AI prompt + JSON output
        })
    rows.sort(key=lambda r: r["serp_comp_score"], reverse=True)
    if top_n:
        rows = rows[:top_n]
    return rows


def ai_comp_levels(
    client,
    model: str,
    project_name: str,
    own_domain: str,
    competitor_rows: List[dict],
) -> Dict[str, dict]:
    """
    One OpenAI chat completion per project: feed all competitor stats, get
    back a comparative High/Medium/Low judgement + short reasoning per
    domain.
    """
    if not competitor_rows:
        return {}

    payload = [
        {
            "domain": r["competitor_domain"],
            "ranking_keywords": r["ranking_keywords"],
            "total_keywords": r["total_keywords"],
            "avg_rank": r["avg_rank"],
            "keyword_positions": r["keyword_positions"],
        }
        for r in competitor_rows
    ]

    system_prompt = (
        "You are an SEO competitive analyst. You will be given, for one client domain, "
        "a list of competitor domains along with how many of the client's target keywords "
        "each competitor ranks for, their average rank position, and per-keyword positions.\n\n"
        "For each competitor, assign a competitive strength level relative to the others in "
        "this same list:\n"
        "- 'High': ranks for a large share of the keyword set at consistently strong positions.\n"
        "- 'Medium': ranks for a moderate share, or ranks well but only for a few keywords.\n"
        "- 'Low': minimal keyword coverage and/or consistently weak positions.\n\n"
        "Judge levels RELATIVE to the other competitors provided, not against an absolute scale. "
        "Give a one-sentence reasoning per competitor.\n\n"
        "Output ONLY a raw JSON array, no markdown, no preamble, in this exact shape:\n"
        '[{"domain": "string", "ai_comp_level": "High"|"Medium"|"Low", "ai_comp_reasoning": "string"}]'
    )

    user_prompt = (
        f"Client domain: {own_domain}\nProject: {project_name}\n\n"
        f"Competitor data:\n{json.dumps(payload, indent=2)}"
    )

    try:
        resp = client.chat.completions.create(
            model=model,
            max_tokens=2000,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        text = (resp.choices[0].message.content or "").strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
        parsed = json.loads(text)
        return {item["domain"]: item for item in parsed}
    except Exception as e:
        print(f"[AI comp level] Failed for project '{project_name}': {e}")
        return {}


def find_competitors_for_rows(
    rows: List[dict],
    project_name: str,
    exclude_domains: Optional[set] = None,
    top_n: Optional[int] = None,
    use_ai: bool = True,
    model: Optional[str] = None,
):
    """Entry point for the backend: given a project's keyword_categories
    rows (as returned by db.get_domain_results()), returns
    (competitor_rows, own_domain). Each competitor row has the same shape
    build_competitor_table() produces, plus ai_comp_level/ai_comp_reasoning
    (empty strings if use_ai is False or no API key is configured)."""
    exclude_domains = DEFAULT_EXCLUDE_DOMAINS if exclude_domains is None else exclude_domains

    df = parse_rank_meta_rows(rows)
    if df.empty:
        return [], ""

    total_keywords = df["keyword"].nunique()
    stats, own_domain = aggregate_competitors(df, exclude_domains)
    table = build_competitor_table(stats, total_keywords, top_n=top_n)

    ai_results = {}
    if use_ai and table:
        if OpenAI is None or not os.environ.get("OPENAI_API_KEY"):
            print("[Warn] OpenAI not available/configured; skipping AI comp levels.")
        else:
            client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
            ai_results = ai_comp_levels(client, model or OPENAI_MODEL_DEFAULT, project_name, own_domain, table)

    results = []
    for r in table:
        ai_info = ai_results.get(r["competitor_domain"], {})
        results.append({
            **r,
            "ai_comp_level": ai_info.get("ai_comp_level", ""),
            "ai_comp_reasoning": ai_info.get("ai_comp_reasoning", ""),
        })
    return results, own_domain


def run(input_csv: str, output_prefix: str, use_ai: bool, top_n: Optional[int],
        exclude_domains: set, project_filter: Optional[str], model: str):
    df = load_rows(input_csv)

    if project_filter:
        df = df[df["project_name"] == project_filter]
        if df.empty:
            print(f"No rows found for project '{project_filter}'.")
            sys.exit(1)

    client = None
    if use_ai:
        if OpenAI is None:
            print("[Warn] openai package not installed; skipping AI comp levels.")
            use_ai = False
        elif not os.environ.get("OPENAI_API_KEY"):
            print("[Warn] OPENAI_API_KEY not set; skipping AI comp levels.")
            use_ai = False
        else:
            client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

    all_output_rows = []

    for project_name, project_rows in df.groupby("project_name"):
        total_keywords = project_rows["keyword"].nunique()
        stats, own_domain = aggregate_competitors(project_rows, exclude_domains)
        table = build_competitor_table(stats, total_keywords, top_n=top_n)

        print(f"\nProject: {project_name}  (own domain: {own_domain or 'unknown'})")
        print(f"  Total distinct keywords checked: {total_keywords}")
        print(f"  Competitors found: {len(table)}")

        ai_results = {}
        if use_ai:
            print("  Requesting AI competitor levels from OpenAI...")
            ai_results = ai_comp_levels(client, model, project_name, own_domain, table)

        for r in table:
            ai_info = ai_results.get(r["competitor_domain"], {})
            all_output_rows.append({
                "project_name": project_name,
                "own_domain": own_domain,
                "competitor_domain": r["competitor_domain"],
                "total_keywords": r["total_keywords"],
                "ranking_keywords": r["ranking_keywords"],
                "coverage_pct": r["coverage_pct"],
                "avg_rank": r["avg_rank"],
                "serp_comp_level": r["serp_comp_level"],
                "serp_comp_score": r["serp_comp_score"],
                "ai_comp_level": ai_info.get("ai_comp_level", ""),
                "ai_comp_reasoning": ai_info.get("ai_comp_reasoning", ""),
                "ranking_keyword_list": "; ".join(
                    f"{kw} (#{pos})" for kw, pos in r["keyword_positions"].items()
                ),
            })

    out_csv = f"{output_prefix}_competitors.csv"
    out_json = f"{output_prefix}_competitors.json"
    out_df = pd.DataFrame(all_output_rows)
    out_df.to_csv(out_csv, index=False)
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(all_output_rows, f, indent=2, ensure_ascii=False)

    print(f"\nSaved:\n  {out_csv}\n  {out_json}")
    return out_df


def main():
    parser = argparse.ArgumentParser(description="Aggregate SERP rank_meta into a competitor intelligence report.")
    parser.add_argument("--input", required=True, help="Path to keyword_categories_rows.csv")
    parser.add_argument("--output-prefix", default=None, help="Prefix for output files (default: <input>_report)")
    parser.add_argument("--project", default=None, help="Filter to a single project_name")
    parser.add_argument("--top-n", type=int, default=None, help="Limit to top N competitors per project by SERP score")
    parser.add_argument("--no-ai", action="store_true", help="Skip OpenAI AI comp-level scoring (rule-based only)")
    parser.add_argument("--model", default=OPENAI_MODEL_DEFAULT, help="OpenAI model to use")
    parser.add_argument(
        "--include-directories", action="store_true",
        help="Include directory/social domains (Justdial, Quora, YouTube, etc.) as competitors"
    )
    args = parser.parse_args()

    output_prefix = args.output_prefix or os.path.splitext(os.path.abspath(args.input))[0] + "_report"
    exclude = set() if args.include_directories else DEFAULT_EXCLUDE_DOMAINS

    run(
        input_csv=args.input,
        output_prefix=output_prefix,
        use_ai=not args.no_ai,
        top_n=args.top_n,
        exclude_domains=exclude,
        project_filter=args.project,
        model=args.model,
    )


if __name__ == "__main__":
    main()
