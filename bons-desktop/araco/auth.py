"""Password hashing (PBKDF2-SHA256, standard library only)."""
import hashlib
import hmac
import secrets

ITERATIONS = 200_000


def hash_password(password: str, salt: str | None = None, iterations: int = ITERATIONS) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), iterations)
    return f"pbkdf2_sha256${iterations}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt, expected = stored.split("$")
    except (ValueError, AttributeError):
        return False
    if algo != "pbkdf2_sha256":
        return False
    candidate = hash_password(password, salt, int(iterations)).split("$")[3]
    return hmac.compare_digest(candidate, expected)
