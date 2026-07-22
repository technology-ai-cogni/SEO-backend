"""
Agent registry and shared constants.
"""
from .base_agent   import BaseAgent, CLIENT_DOMAIN, DATASETS_DIR
from .openai_agent import OpenAIAgent
from .gemini_agent import GeminiAgent
from .claude_agent import ClaudeAgent

AGENTS = {
    "openai": OpenAIAgent,
    "gemini": GeminiAgent,
    "claude": ClaudeAgent,
}

__all__ = ["BaseAgent", "OpenAIAgent", "GeminiAgent", "ClaudeAgent", "AGENTS",
           "CLIENT_DOMAIN", "DATASETS_DIR"]
