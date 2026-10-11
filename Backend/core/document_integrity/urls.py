from django.urls import path

from .views import DocumentVerifyUploadView

urlpatterns = [
    path("verify-upload/", DocumentVerifyUploadView.as_view(), name="document_verify_upload"),
]
