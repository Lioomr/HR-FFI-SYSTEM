from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    CEOLoanRequestViewSet,
    CFOLoanRequestViewSet,
    EmployeeLoanRequestViewSet,
    LoanRequestViewSet,
    ManagerLoanRequestViewSet,
)

router = DefaultRouter()
router.trailing_slash = "/?"
router.register(r"loan-requests", LoanRequestViewSet, basename="loan-requests")
router.register(r"employee/loan-requests", EmployeeLoanRequestViewSet, basename="employee-loan-requests")
router.register(r"manager/loan-requests", ManagerLoanRequestViewSet, basename="manager-loan-requests")
router.register(r"cfo/loan-requests", CFOLoanRequestViewSet, basename="cfo-loan-requests")
router.register(r"ceo/loan-requests", CEOLoanRequestViewSet, basename="ceo-loan-requests")

urlpatterns = [
    path("", include(router.urls)),
]
