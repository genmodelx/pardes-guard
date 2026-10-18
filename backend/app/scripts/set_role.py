"""Give a signed-up Firebase user a role (worker, family, ngo, admin).

    python -m app.scripts.set_role +923001234567 ngo
    python -m app.scripts.set_role <firebase-uid> admin

Uses Application Default Credentials for GOOGLE_CLOUD_PROJECT. The role travels in the user's ID token
as the custom claim `role`; the user must sign out and in again (or wait for the hourly token refresh).
"""

from __future__ import annotations

import argparse
import sys

ROLES = ("worker", "family", "ngo", "admin")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("user", help="Firebase UID, or a phone number in +country format")
    parser.add_argument("role", choices=ROLES)
    args = parser.parse_args()

    import firebase_admin
    from firebase_admin import auth

    from app.config import get_settings

    project = get_settings().google_cloud_project
    if not firebase_admin._apps:  # noqa: SLF001 - documented way to check initialisation
        firebase_admin.initialize_app(options={"projectId": project} if project else None)

    record = auth.get_user_by_phone_number(args.user) if args.user.startswith("+") else auth.get_user(args.user)
    claims = dict(record.custom_claims or {})
    claims["role"] = args.role
    auth.set_custom_user_claims(record.uid, claims)
    print(f"{record.uid}: role={args.role}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
