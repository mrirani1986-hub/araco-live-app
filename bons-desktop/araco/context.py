"""The logged-in session passed to every service call, plus shared errors."""
from dataclasses import dataclass

from .db import Database


class ValidationError(Exception):
    """Carries a list of i18n keys (or (key, params) pairs) describing what is wrong."""

    def __init__(self, errors):
        super().__init__(", ".join(e if isinstance(e, str) else e[0] for e in errors))
        self.errors = list(errors)


class NotAllowed(Exception):
    """The current user's role may not do this."""


@dataclass
class Ctx:
    db: Database
    user: dict  # id, username, full_name, role

    @property
    def is_admin(self) -> bool:
        return self.user.get("role") == "admin"

    @property
    def user_id(self):
        return self.user.get("id")

    def require_admin(self):
        if not self.is_admin:
            raise NotAllowed("admin_only")
