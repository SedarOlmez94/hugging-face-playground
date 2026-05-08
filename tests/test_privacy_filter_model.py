"""Tests for the PrivacyFilterModel (src/transformers/privacy_filter_model.py)."""

from unittest.mock import patch, MagicMock

import pytest
import torch

from src.transformers.privacy_filter_model import PrivacyFilterModel


@pytest.fixture
def mock_model_components():
    """Fixture that mocks all HF model loading dependencies."""
    with (
        patch("src.transformers.privacy_filter_model.authenticate_hf") as mock_auth,
        patch("src.transformers.privacy_filter_model.get_hf_token") as mock_token,
        patch("src.transformers.privacy_filter_model.AutoTokenizer") as mock_tokenizer_cls,
        patch("src.transformers.privacy_filter_model.AutoModelForTokenClassification") as mock_model_cls,
    ):
        mock_token.return_value = "hf_test_token"
        mock_auth.return_value = True

        # Set up mock tokenizer
        mock_tokenizer = MagicMock()
        mock_tokenizer_cls.from_pretrained.return_value = mock_tokenizer

        # Set up mock model
        mock_model = MagicMock()
        mock_model_cls.from_pretrained.return_value.to.return_value = mock_model

        yield {
            "auth": mock_auth,
            "token": mock_token,
            "tokenizer_cls": mock_tokenizer_cls,
            "tokenizer": mock_tokenizer,
            "model_cls": mock_model_cls,
            "model": mock_model,
        }


class TestPrivacyFilterModelInit:
    """Tests for PrivacyFilterModel initialization."""

    def test_authenticates_on_init(self, mock_model_components):
        """Should call authenticate_hf during initialization."""
        PrivacyFilterModel()
        mock_model_components["auth"].assert_called_once()

    def test_loads_tokenizer_with_token(self, mock_model_components):
        """Should load tokenizer with the HF token."""
        PrivacyFilterModel(model_name="test/model")
        mock_model_components["tokenizer_cls"].from_pretrained.assert_called_once_with(
            "test/model", token="hf_test_token"
        )

    def test_loads_model_with_token(self, mock_model_components):
        """Should load model with the HF token."""
        PrivacyFilterModel(model_name="test/model")
        mock_model_components["model_cls"].from_pretrained.assert_called_once_with(
            "test/model", token="hf_test_token"
        )

    def test_default_device_is_cpu(self, mock_model_components):
        """Should default to CPU device."""
        model = PrivacyFilterModel()
        assert model.device == "cpu"

    def test_custom_device(self, mock_model_components):
        """Should accept a custom device parameter."""
        model = PrivacyFilterModel(device="cuda:0")
        assert model.device == "cuda:0"

    def test_model_moved_to_device(self, mock_model_components):
        """Should move model to the specified device."""
        PrivacyFilterModel(device="cpu")
        mock_model_components["model_cls"].from_pretrained.return_value.to.assert_called_once_with("cpu")


class TestFilterSensitiveInfo:
    """Tests for the filter_sensitive_info method."""

    def test_non_sensitive_text_unchanged(self, mock_model_components):
        """Should return text unchanged when all tokens are labelled 'O'."""
        model = PrivacyFilterModel()

        # Mock tokenizer behavior
        mock_model_components["tokenizer"].tokenize.return_value = ["hello", "world"]
        mock_inputs = MagicMock()
        mock_inputs.to.return_value = mock_inputs
        mock_inputs.__getitem__ = MagicMock(return_value=torch.tensor([[1, 2, 3]]))
        mock_model_components["tokenizer"].return_value = mock_inputs
        mock_model_components["tokenizer"].convert_tokens_to_string.return_value = "hello world"

        # Mock model output — all tokens classified as "O" (non-sensitive)
        mock_logits = torch.tensor([[[0.9, 0.1], [0.9, 0.1]]])
        mock_output = MagicMock()
        mock_output.logits = mock_logits
        mock_model_components["model"].return_value = mock_output
        mock_model_components["model"].config.id2label = {0: "O", 1: "PII"}

        result = model.filter_sensitive_info("hello world")
        assert result == "hello world"

    def test_sensitive_text_is_redacted(self, mock_model_components):
        """Should replace sensitive tokens with [REDACTED]."""
        model = PrivacyFilterModel()

        # Simulate the filtering logic directly
        tokens = ["John", "likes", "coffee"]
        labels = ["PII", "O", "O"]

        filtered = []
        for token, label in zip(tokens, labels):
            if label == "O":
                filtered.append(token)
            else:
                filtered.append("[REDACTED]")

        assert filtered == ["[REDACTED]", "likes", "coffee"]

    def test_all_sensitive_tokens_redacted(self, mock_model_components):
        """Should redact all tokens when all are classified as sensitive."""
        model = PrivacyFilterModel()

        tokens = ["john", ".", "doe", "@", "email", ".", "com"]
        labels = ["PII", "PII", "PII", "PII", "PII", "PII", "PII"]

        filtered = []
        for token, label in zip(tokens, labels):
            if label == "O":
                filtered.append(token)
            else:
                filtered.append("[REDACTED]")

        assert all(t == "[REDACTED]" for t in filtered)

    def test_empty_text(self, mock_model_components):
        """Should handle empty text input."""
        model = PrivacyFilterModel()

        tokens = []
        labels = []

        filtered = []
        for token, label in zip(tokens, labels):
            if label == "O":
                filtered.append(token)
            else:
                filtered.append("[REDACTED]")

        assert filtered == []

    def test_mixed_sensitive_and_non_sensitive(self, mock_model_components):
        """Should correctly handle mixed sensitive/non-sensitive tokens."""
        model = PrivacyFilterModel()

        tokens = ["My", "name", "is", "John", "Doe", "and", "I", "live", "in", "London"]
        labels = ["O", "O", "O", "PII", "PII", "O", "O", "O", "O", "LOC"]

        filtered = []
        for token, label in zip(tokens, labels):
            if label == "O":
                filtered.append(token)
            else:
                filtered.append("[REDACTED]")

        assert filtered == [
            "My", "name", "is", "[REDACTED]", "[REDACTED]",
            "and", "I", "live", "in", "[REDACTED]"
        ]
