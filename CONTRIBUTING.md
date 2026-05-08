# Contributing to Hugging Face Playground

First off, thank you for considering contributing! 🎉

This is an open-source learning project, and contributions of all kinds are welcome — whether it's fixing a typo, adding a new experiment, improving documentation, or suggesting ideas.

## 📋 How to Contribute

### Reporting Bugs or Suggesting Features

1. Check if an [issue](https://github.com/SedarOlmez94/hugging-face-playground/issues) already exists
2. If not, open a new issue with a clear title and description
3. For bugs, include steps to reproduce and your environment details

### Submitting Changes

1. **Fork** the repository
2. **Create a branch** for your feature or fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes** following the code style guidelines below
4. **Write tests** for any new functionality
5. **Run the test suite** to ensure nothing is broken:
   ```bash
   pytest
   ```
6. **Commit** with a clear message:
   ```bash
   git commit -m "Add: brief description of your change"
   ```
7. **Push** to your fork and submit a **Pull Request**

## 🧑‍💻 Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/hugging-face-playground.git
cd hugging-face-playground

# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install all dependencies
pip install -r requirements.txt
pip install -r requirements-dev.txt
pip install -e .

# Set up pre-commit hooks
pre-commit install
```

## 📐 Code Style

- **Formatter:** [Black](https://github.com/psf/black) (line length: 88)
- **Import sorting:** [isort](https://pycqa.github.io/isort/) (black profile)
- **Linting:** [flake8](https://flake8.pycqa.org/)
- **Type hints:** Encouraged for all public functions

Run formatting before committing:

```bash
black src/ tests/
isort src/ tests/
flake8 src/ tests/
```

## ✅ Testing

- All new features should include tests
- Place tests in the `tests/` directory
- Use descriptive test names: `test_tokenizer_handles_empty_input`
- Run tests with: `pytest -v`

## 📝 Commit Message Convention

Use clear, descriptive commit messages:

- `Add: new transformer sentiment analysis example`
- `Fix: tokenizer handling of special characters`
- `Docs: update README with new examples`
- `Test: add coverage for dataset loader`
- `Refactor: simplify model loading utility`

## 🙏 Code of Conduct

Be kind, respectful, and constructive. We're all here to learn!

---

Thank you for helping make this project better! 🤗
