from django.utils.timezone import now, timedelta
from django.core.mail import send_mail
from django.conf import settings


def send_invite(user, temp_password):
    user.must_change_password = True
    user.invite_expires_at = now() + timedelta(hours=24)
    user.set_password(temp_password)
    user.save()

    send_mail(
        subject="Your Account Access",
        message=(
            f"Welcome!\n\n"
            f"Email: {user.email}\n"
            f"Temporary Password: {temp_password}\n\n"
            f"This password expires in 24 hours and must be changed on first login."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
    )
