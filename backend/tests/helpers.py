from __future__ import annotations


def contract_text(**overrides: str) -> bytes:
    fields = {
        "Document": "contract",
        "Employer": "Al Faris Trading Est",
        "Job title": "Heavy driver",
        "Visa type": "work",
        "Salary": "1500 SAR per month",
        "Hours": "48 per week",
        "Passport": "Worker keeps own passport",
        "Accommodation": "yes",
        "Food": "yes",
        "Medical": "yes",
        "Return ticket": "yes",
        "Country": "SA",
    }
    fields.update(overrides)
    return "\n".join(f"{k}: {v}" for k, v in fields.items() if v is not None).encode()


def dev_headers(user: str = "w1", role: str = "worker") -> dict[str, str]:
    return {"X-Dev-User": user, "X-Dev-Role": role}
