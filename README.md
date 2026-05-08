# 🤗 Hugging Face Playground

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![Tests](https://github.com/SedarOlmez94/hugging-face-playground/actions/workflows/tests.yml/badge.svg)](https://github.com/SedarOlmez94/hugging-face-playground/actions/workflows/tests.yml)
[![Hugging Face](https://img.shields.io/badge/%F0%9F%A4%97-Hugging%20Face-orange)](https://huggingface.co/)
[![Code style: black](https://img.shields.io/badge/code%20style-black-000000.svg)](https://github.com/psf/black)
[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](CONTRIBUTING.md)

A hands-on learning playground for exploring [Hugging Face](https://huggingface.co/) and its ecosystem — including Transformers, Datasets, Tokenizers, Diffusers, and more.

---

## 📖 About

This repository is an open-source collection of experiments, examples, and mini-projects built using the Hugging Face ecosystem. It serves as a personal learning journal and a resource for anyone looking to get started with:

- 🧠 **Transformers** — NLP, computer vision, and multimodal models
- 📦 **Datasets** — Loading, processing, and exploring datasets
- ✂️ **Tokenizers** — Understanding tokenization strategies
- 🎨 **Diffusers** — Image generation and diffusion models
- 🚀 **Inference API** — Using hosted models via the Hugging Face Hub
- 📊 **Evaluate** — Model evaluation and benchmarking

## 🚀 Getting Started

### Prerequisites

- Python 3.10 or higher
- pip or conda package manager
- (Optional) CUDA-compatible GPU for accelerated inference

### Installation

1. **Clone the repository:**

```bash
git clone https://github.com/SedarOlmez94/hugging-face-playground.git
cd hugging-face-playground
```

2. **Create a virtual environment:**

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. **Install dependencies:**

```bash
pip install -r requirements.txt
```

4. **Install dev dependencies (for testing & linting):**

```bash
pip install -r requirements-dev.txt
```

## 📁 Project Structure

```
hugging-face-playground/
├── src/                    # Source code and experiments
│   ├── transformers/       # Transformer model experiments
│   ├── datasets/           # Dataset loading & processing
│   ├── tokenizers/         # Tokenizer explorations
│   ├── diffusers/          # Diffusion model experiments
│   └── utils/              # Shared utility functions
├── tests/                  # Unit and integration tests
├── notebooks/              # Jupyter notebooks for exploration
├── docs/                   # Documentation and notes
├── .github/workflows/      # CI/CD pipelines
├── requirements.txt        # Production dependencies
├── requirements-dev.txt    # Development dependencies
├── setup.cfg               # Project configuration
├── pyproject.toml          # Build system configuration
├── CONTRIBUTING.md         # Contribution guidelines
├── LICENSE                 # MIT License
└── README.md               # This file
```

## 🧪 Running Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src --cov-report=html

# Run a specific test file
pytest tests/test_transformers.py -v
```

## 🛠️ Development

### Code Formatting & Linting

```bash
# Format code
black src/ tests/

# Sort imports
isort src/ tests/

# Lint
flake8 src/ tests/
```

### Pre-commit Hooks

```bash
pre-commit install
pre-commit run --all-files
```

## 🤝 Contributing

Contributions are welcome! Whether it's fixing a bug, adding a new experiment, or improving documentation — all contributions are appreciated.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on the process for submitting pull requests.

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgements

- [Hugging Face](https://huggingface.co/) for building an incredible open-source AI ecosystem
- The open-source community for continuous inspiration

---

**Happy Learning! 🤗**
