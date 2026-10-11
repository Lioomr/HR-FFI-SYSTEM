from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import RequestFactory, TestCase

from organization.models import OrganizationNode, UserOrganizationAccess
from organization.services import get_active_organization_for_request

User = get_user_model()


class ActiveOrganizationCacheTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="hr-cache@example.com", password="x")
        self.user.groups.add(Group.objects.get_or_create(name="HRManager")[0])
        self.company = OrganizationNode.objects.create(
            code="CACHE_CO", name="Cache Co", node_type=OrganizationNode.NodeType.COMPANY
        )
        UserOrganizationAccess.objects.create(user=self.user, organization=self.company)

    def _request(self, **extra):
        request = RequestFactory().get("/", **extra)
        request.user = self.user
        return request

    def test_second_lookup_on_the_same_request_runs_no_queries(self):
        request = self._request()
        first = get_active_organization_for_request(request)
        with self.assertNumQueries(0):
            second = get_active_organization_for_request(request)
        self.assertEqual(first, second)

    def test_each_request_resolves_its_own_selection(self):
        other = OrganizationNode.objects.create(
            code="CACHE_OTHER", name="Other Co", node_type=OrganizationNode.NodeType.COMPANY
        )
        UserOrganizationAccess.objects.create(user=self.user, organization=other)

        first = get_active_organization_for_request(self._request(HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id)))
        second = get_active_organization_for_request(self._request(HTTP_X_ACTIVE_COMPANY_ID=str(other.id)))

        self.assertEqual(first, self.company)
        self.assertEqual(second, other)
