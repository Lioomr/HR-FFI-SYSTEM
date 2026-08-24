from django.urls import path

from .views import (
    HiringRequestApproveView,
    HiringRequestCancelView,
    HiringRequestCvView,
    HiringRequestDetailView,
    HiringRequestListCreateView,
    HiringRequestRejectView,
    HiringRequestSubmitView,
    JobOfferCancelView,
    JobOfferDetailView,
    JobOfferListCreateView,
    JobOfferPdfView,
    JobOfferRespondView,
    JobOfferSendView,
)

urlpatterns = [
    path("hiring-requests/", HiringRequestListCreateView.as_view(), name="hiring-request-list-create"),
    path(
        "hiring-requests/<int:hiring_request_id>/",
        HiringRequestDetailView.as_view(),
        name="hiring-request-detail",
    ),
    path(
        "hiring-requests/<int:hiring_request_id>/submit/",
        HiringRequestSubmitView.as_view(),
        name="hiring-request-submit",
    ),
    path(
        "hiring-requests/<int:hiring_request_id>/cancel/",
        HiringRequestCancelView.as_view(),
        name="hiring-request-cancel",
    ),
    path(
        "hiring-requests/<int:hiring_request_id>/cv/",
        HiringRequestCvView.as_view(),
        name="hiring-request-cv",
    ),
    path(
        "hiring-requests/<int:hiring_request_id>/approve/",
        HiringRequestApproveView.as_view(),
        name="hiring-request-approve",
    ),
    path(
        "hiring-requests/<int:hiring_request_id>/reject/",
        HiringRequestRejectView.as_view(),
        name="hiring-request-reject",
    ),
    path("job-offers/", JobOfferListCreateView.as_view(), name="job-offer-list-create"),
    path("job-offers/respond/", JobOfferRespondView.as_view(), name="job-offer-respond"),
    path("job-offers/<int:offer_id>/", JobOfferDetailView.as_view(), name="job-offer-detail"),
    path("job-offers/<int:offer_id>/send/", JobOfferSendView.as_view(), name="job-offer-send"),
    path("job-offers/<int:offer_id>/pdf/", JobOfferPdfView.as_view(), name="job-offer-pdf"),
    path("job-offers/<int:offer_id>/cancel/", JobOfferCancelView.as_view(), name="job-offer-cancel"),
]
