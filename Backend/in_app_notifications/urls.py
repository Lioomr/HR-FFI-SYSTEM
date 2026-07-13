from django.urls import path

from .views import NotificationListView, NotificationReadAllView, NotificationReadView, NotificationUnreadCountView

app_name = "in_app_notifications"

urlpatterns = [
    path("", NotificationListView.as_view(), name="list"),
    path("unread-count/", NotificationUnreadCountView.as_view(), name="unread-count"),
    path("read-all/", NotificationReadAllView.as_view(), name="read-all"),
    path("<int:notification_id>/read/", NotificationReadView.as_view(), name="read"),
]
