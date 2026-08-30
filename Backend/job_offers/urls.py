from django.urls import path

from .views import (
    JobOfferApproveView,
    JobOfferCancelView,
    JobOfferCvView,
    JobOfferDetailView,
    JobOfferListCreateView,
    JobOfferPdfView,
    JobOfferRejectView,
    JobOfferRequestChangesView,
    JobOfferRespondView,
    JobOfferSendView,
    JobOfferSubmitView,
)

urlpatterns = [
    path("job-offers/", JobOfferListCreateView.as_view(), name="job-offer-list-create"),
    path("job-offers/respond/", JobOfferRespondView.as_view(), name="job-offer-respond"),
    path("job-offers/<int:offer_id>/", JobOfferDetailView.as_view(), name="job-offer-detail"),
    path("job-offers/<int:offer_id>/submit/", JobOfferSubmitView.as_view(), name="job-offer-submit"),
    path("job-offers/<int:offer_id>/approve/", JobOfferApproveView.as_view(), name="job-offer-approve"),
    path(
        "job-offers/<int:offer_id>/request-changes/",
        JobOfferRequestChangesView.as_view(),
        name="job-offer-request-changes",
    ),
    path("job-offers/<int:offer_id>/reject/", JobOfferRejectView.as_view(), name="job-offer-reject"),
    path("job-offers/<int:offer_id>/cv/", JobOfferCvView.as_view(), name="job-offer-cv"),
    path("job-offers/<int:offer_id>/send/", JobOfferSendView.as_view(), name="job-offer-send"),
    path("job-offers/<int:offer_id>/pdf/", JobOfferPdfView.as_view(), name="job-offer-pdf"),
    path("job-offers/<int:offer_id>/cancel/", JobOfferCancelView.as_view(), name="job-offer-cancel"),
]
