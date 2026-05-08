"""
Author: SedarOlmez94
Date: 08/05/2026
Description: This module defines the PrivacyFilterModel class, which is a transformer-based model designed
for privacy filtering tasks. The model utilizes a pre-trained transformer architecture to identify and
filter out sensitive information from text data. It can be fine-tuned on specific datasets to improve
its performance in various privacy-related applications, such as data anonymisation and content moderation.

The model source code can be found at huggingface.co/openai/privacy-filter
"""

import torch
from transformers import AutoModelForTokenClassification, AutoTokenizer

from src.utils.config import authenticate_hf, get_hf_token


class PrivacyFilterModel:
    """
    A transformer-based model for privacy filtering tasks. This model identifies and filters out sensitive
    information from text data. It can be fine-tuned on specific datasets to improve its performance
    in various privacy-related applications, such as data anonymisation and content moderation.
    """

    def __init__(self, model_name="openai/privacy-filter", device="cpu"):
        authenticate_hf()
        token = get_hf_token()
        self.device = device
        self.tokenizer = AutoTokenizer.from_pretrained(model_name, token=token)
        self.model = AutoModelForTokenClassification.from_pretrained(
            model_name, token=token
        ).to(self.device)

    def filter_sensitive_info(self, text: str):
        inputs = self.tokenizer(text, return_tensors="pt").to(self.device)
        with torch.no_grad():
            outputs = self.model(**inputs)

        predicted_token_class_ids = outputs.logits.argmax(dim=-1)
        predicted_token_classes = [
            self.model.config.id2label[token_id.item()]
            for token_id in predicted_token_class_ids[0]
        ]

        filtered_text = []
        for token, label in zip(self.tokenizer.tokenize(text), predicted_token_classes):
            if label == "O":  # Assuming "O" is the label for non-sensitive tokens
                filtered_text.append(token)
            else:
                filtered_text.append(
                    "[REDACTED]"
                )  # Replace sensitive tokens with a placeholder

        return self.tokenizer.convert_tokens_to_string(filtered_text)
