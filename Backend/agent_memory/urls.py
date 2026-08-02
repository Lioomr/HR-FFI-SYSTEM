from django.urls import path

from .views import MemoryRecallView, MemoryRememberView, MemoryStatusView

urlpatterns = [
    path("status/", MemoryStatusView.as_view(), name="memory-status"),
    path("recall/", MemoryRecallView.as_view(), name="memory-recall"),
    path("remember/", MemoryRememberView.as_view(), name="memory-remember"),
]
