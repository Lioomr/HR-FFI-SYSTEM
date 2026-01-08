from django.core.mail import send_mail
from django.conf import settings


def send_invite_email(email, temp_password):
    send_mail(
        subject="Your Account Access",
        message=(
            "Welcome!\n\n"
            f"Email: {email}\n"
            f"Temporary Password: {temp_password}\n\n"
            "This password is valid for 24 hours.\n"
            "You will be required to change it on first login."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
        fail_silently=False,
    )
