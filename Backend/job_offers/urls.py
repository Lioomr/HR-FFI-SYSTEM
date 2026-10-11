from django.urls import path

from .views import (
    JobOfferApproveView,
    JobOfferCancelView,
    JobOfferCvView,
    JobOfferDetailView,
    JobOfferIntegrityViewSet,
    JobOfferListCreateView,
    JobOfferPdfView,
    JobOfferRejectView,
    JobOfferRequestChangesView,
    JobOfferRespondView,
    JobOfferSendView,
    JobOfferSubmitView,
    StartingWorkAcknowledgmentApproveView,
    StartingWorkAcknowledgmentDetailView,
    StartingWorkAcknowledgmentIntegrityViewSet,
    StartingWorkAcknowledgmentListView,
    StartingWorkAcknowledgmentPdfView,
    StartingWorkAcknowledgmentRejectView,
    StartingWorkAcknowledgmentVoidView,
)


def _integrity_routes(prefix: str, viewset, name: str) -> list:
    """GET integrity/, POST integrity/verify/, POST integrity/retry-seal/ (document integrity)."""

    return [
        path(f"{prefix}/<int:pk>/integrity/", viewset.as_view({"get": "integrity"}), name=f"{name}-integrity"),
        path(
            f"{prefix}/<int:pk>/integrity/verify/",
            viewset.as_view({"post": "integrity_verify"}),
            name=f"{name}-integrity-verify",
        ),
        path(
            f"{prefix}/<int:pk>/integrity/retry-seal/",
            viewset.as_view({"post": "integrity_retry_seal"}),
            name=f"{name}-integrity-retry-seal",
        ),
    ]


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
    path(
        "starting-work-acknowledgments/",
        StartingWorkAcknowledgmentListView.as_view(),
        name="starting-work-acknowledgment-list",
    ),
    path(
        "starting-work-acknowledgments/<int:acknowledgment_id>/",
        StartingWorkAcknowledgmentDetailView.as_view(),
        name="starting-work-acknowledgment-detail",
    ),
    path(
        "starting-work-acknowledgments/<int:acknowledgment_id>/pdf/",
        StartingWorkAcknowledgmentPdfView.as_view(),
        name="starting-work-acknowledgment-pdf",
    ),
    path(
        "starting-work-acknowledgments/<int:acknowledgment_id>/approve/",
        StartingWorkAcknowledgmentApproveView.as_view(),
        name="starting-work-acknowledgment-approve",
    ),
    path(
        "starting-work-acknowledgments/<int:acknowledgment_id>/reject/",
        StartingWorkAcknowledgmentRejectView.as_view(),
        name="starting-work-acknowledgment-reject",
    ),
    path(
        "starting-work-acknowledgments/<int:acknowledgment_id>/void/",
        StartingWorkAcknowledgmentVoidView.as_view(),
        name="starting-work-acknowledgment-void",
    ),
]
urlpatterns += _integrity_routes("job-offers", JobOfferIntegrityViewSet, "job-offer")
urlpatterns += _integrity_routes(
    "starting-work-acknowledgments", StartingWorkAcknowledgmentIntegrityViewSet, "starting-work-acknowledgment"
)
