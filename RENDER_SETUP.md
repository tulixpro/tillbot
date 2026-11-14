# Render setup for TILLBOT

Existing required backend settings (keep these):
- `DATABASE_URL`: PostgreSQL connection URL
- `JWT_SECRET`: long random secret (at least 32 characters)
- `GROQ_API_KEY`: AI API key

Optional operational email alert settings (new):
- `SMTP_HOST`: SMTP server hostname
- `SMTP_PORT`: usually `465` (TLS) or `587` (STARTTLS)
- `SMTP_USER`: SMTP login
- `SMTP_PASS`: SMTP password/API key (secret; never put it in GitHub)
- `SMTP_FROM`: verified sender, e.g. `TILLBOT <alerts@your-domain.example>`
- `ADMIN_ALERT_EMAIL`: address that receives overload alerts
- `MEMORY_LIMIT_MB`: optional memory limit in MB for Render instance; enables RSS threshold checks

The server sends an overload email only after memory pressure remains high for 2 minutes,
then applies a 30-minute cooldown. If SMTP is not configured, email alerts are disabled
and the app still runs. No database/user content is included in the alert.

Before merging/deploying: install dependencies, run syntax checks, test SMTP delivery,
verify the cooldown, and test against a staging database/Render service. Email verification,
login OTP/2FA, profile image and full UI polish are separate unfinished tasks—not enabled
by this initial commit.
