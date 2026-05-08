"""Tests for utility functions (src/utils/config.py)."""

import os
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from src.utils.config import load_env, get_hf_token, authenticate_hf


class TestLoadEnv:
    """Tests for the load_env function."""

    @patch("src.utils.config.load_dotenv")
    def test_load_env_with_env_local(self, mock_load_dotenv, tmp_path):
        """Should load .env.local when it exists."""
        env_file = tmp_path / ".env.local"
        env_file.write_text("HUGGING_FACE_ACCESS_TOKEN=hf_test123")

        with patch("src.utils.config.Path") as mock_path:
            mock_path.return_value.resolve.return_value.parent.parent.parent = tmp_path
            # Simulate Path(__file__).resolve().parent.parent.parent
            mock_resolve = MagicMock()
            mock_resolve.parent.parent.parent = tmp_path
            mock_path.return_value.resolve.return_value = mock_resolve

            load_env()

        mock_load_dotenv.assert_called_once()

    @patch("src.utils.config.load_dotenv")
    @patch("src.utils.config.Path")
    def test_load_env_falls_back_to_env(self, mock_path_cls, mock_load_dotenv, tmp_path):
        """Should fall back to .env when .env.local does not exist."""
        # Create only .env (not .env.local)
        env_file = tmp_path / ".env"
        env_file.write_text("HF_TOKEN=hf_fallback")

        mock_resolve = MagicMock()
        mock_resolve.parent.parent.parent = tmp_path
        mock_path_cls.return_value.resolve.return_value = mock_resolve

        load_env()

        # Should be called with the .env fallback path
        mock_load_dotenv.assert_called_once_with(tmp_path / ".env")


class TestGetHfToken:
    """Tests for the get_hf_token function."""

    @patch("src.utils.config.load_env")
    def test_returns_hugging_face_access_token(self, mock_load_env):
        """Should return HUGGING_FACE_ACCESS_TOKEN when set."""
        with patch.dict(os.environ, {"HUGGING_FACE_ACCESS_TOKEN": "hf_abc123"}, clear=False):
            token = get_hf_token()
            assert token == "hf_abc123"

    @patch("src.utils.config.load_env")
    def test_returns_hf_token_as_fallback(self, mock_load_env):
        """Should return HF_TOKEN when HUGGING_FACE_ACCESS_TOKEN is not set."""
        env = {"HF_TOKEN": "hf_fallback456"}
        with patch.dict(os.environ, env, clear=False):
            # Remove HUGGING_FACE_ACCESS_TOKEN if it exists
            os.environ.pop("HUGGING_FACE_ACCESS_TOKEN", None)
            token = get_hf_token()
            assert token == "hf_fallback456"

    @patch("src.utils.config.load_env")
    def test_returns_none_when_no_token(self, mock_load_env):
        """Should return None when no token is set."""
        with patch.dict(os.environ, {}, clear=True):
            token = get_hf_token()
            assert token is None


class TestAuthenticateHf:
    """Tests for the authenticate_hf function."""

    @patch("src.utils.config.login")
    @patch("src.utils.config.get_hf_token")
    def test_authenticate_success(self, mock_get_token, mock_login):
        """Should authenticate successfully when token is available."""
        mock_get_token.return_value = "hf_valid_token"

        result = authenticate_hf()

        assert result is True
        assert os.environ.get("HF_TOKEN") == "hf_valid_token"
        mock_login.assert_called_once_with(token="hf_valid_token", add_to_git_credential=False)

    @patch("src.utils.config.login")
    @patch("src.utils.config.get_hf_token")
    def test_authenticate_fails_without_token(self, mock_get_token, mock_login, capsys):
        """Should return False and print warning when no token is available."""
        mock_get_token.return_value = None

        result = authenticate_hf()

        assert result is False
        mock_login.assert_not_called()
        captured = capsys.readouterr()
        assert "No Hugging Face token found" in captured.out
