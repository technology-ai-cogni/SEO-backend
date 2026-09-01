"""
Agent registry and shared constants.
"""
from .base_agent   import BaseAgent, CLIENT_DOMAIN, DATASETS_DIR
from .openai_agent import OpenAIAgent
from .gemini_agent import GeminiAgent
from .aio_agent    import AIOAgent
from .serpapi_agent import SerpAPIAgent

AGENTS = {
    "openai": OpenAIAgent,
    "chatgpt": OpenAIAgent,
    "gemini": GeminiAgent,
    "serpapi": SerpAPIAgent,
    "ai overview": AIOAgent,
    "aio": AIOAgent,
}

__all__ = ["BaseAgent", "OpenAIAgent", "GeminiAgent", "AIOAgent", "SerpAPIAgent", "AGENTS",
           "CLIENT_DOMAIN", "DATASETS_DIR"]
