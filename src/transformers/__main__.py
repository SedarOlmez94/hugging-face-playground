"""Entry point for running the transformers package as a module."""

from src.transformers.privacy_filter_model import PrivacyFilterModel


def main():
    model = PrivacyFilterModel()
    sample_text = "John Doe's email is john.doe@example.com"
    filtered_text = model.filter_sensitive_info(sample_text)
    print(filtered_text)


if __name__ == "__main__":
    main()
