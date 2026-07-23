"""
Agent registry and shared constants.
"""
from .base_agent   import BaseAgent, CLIENT_DOMAIN, DATASETS_DIR
from .openai_agent import OpenAIAgent
from .gemini_agent import GeminiAgent
from .serpapi_agent import SerpAPIAgent
from .claude_agent import ClaudeAgent

AGENTS = {
    "openai": OpenAIAgent,
    "chatgpt": OpenAIAgent,
    "gemini": GeminiAgent,
    "claude": ClaudeAgent,
    "serpapi": SerpAPIAgent,
    "ai overview": SerpAPIAgent,
}

__all__ = ["BaseAgent", "OpenAIAgent", "GeminiAgent", "ClaudeAgent", "SerpAPIAgent", "AGENTS",
           "CLIENT_DOMAIN", "DATASETS_DIR"]
