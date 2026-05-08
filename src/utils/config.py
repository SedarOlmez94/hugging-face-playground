"""
Configuration utilities for loading environment variables and authenticating with Hugging Face Hub.
"""

import os
from pathlib import Path

from dotenv import load_dotenv
from huggingface_hub import login


def load_env():
    """Load environment variables from .env.local file."""
    project_root = Path(__file__).resolve().parent.parent.parent
    env_file = project_root / ".env.local"

    if env_file.exists():
        load_dotenv(env_file)
    else:
        # Fallback to .env
        load_dotenv(project_root / ".env")


def get_hf_token() -> str | None:
    """Get the Hugging Face access token from environment variables."""
    load_env()
    return os.getenv("HUGGING_FACE_ACCESS_TOKEN") or os.getenv("HF_TOKEN")


def authenticate_hf():
    """Authenticate with Hugging Face Hub using the access token.

    This sets the HF_TOKEN environment variable and logs in to the Hub,
    enabling authenticated requests for gated models and higher rate limits.
    """
    token = get_hf_token()
    if token:
        os.environ["HF_TOKEN"] = token
        login(token=token, add_to_git_credential=False)
        return True
    else:
        print(
            "⚠️  No Hugging Face token found. "
            "Set HUGGING_FACE_ACCESS_TOKEN in .env.local or HF_TOKEN in your environment."
        )
        return False
